import type { ExportJob, LogEntry, LogType } from '@shared/schema';

// Global cooldown state - shared across all jobs
let lastErrorTime = 0;
const ERROR_COOLDOWN_MS = 120000; // 120 seconds

export class ProductiveApiClient {
  private apiToken: string;
  private organizationId: string;
  private baseUrl = 'https://api.productive.io/api/v2';

  constructor(apiToken: string, organizationId: string) {
    this.apiToken = apiToken;
    this.organizationId = organizationId;
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-Auth-Token': this.apiToken,
      'X-Organization-Id': this.organizationId,
      'Content-Type': 'application/vnd.api+json',
    };
  }

  private async waitForCooldown(logCallback: (message: string, type: LogType) => void): Promise<void> {
    const now = Date.now();
    const timeSinceLastError = now - lastErrorTime;
    
    if (timeSinceLastError < ERROR_COOLDOWN_MS) {
      const remainingWait = ERROR_COOLDOWN_MS - timeSinceLastError;
      const secondsRemaining = Math.ceil(remainingWait / 1000);
      logCallback(`Cooling down: waiting ${secondsRemaining}s before retry...`, 'warning');
      await new Promise(resolve => setTimeout(resolve, remainingWait));
    }
  }

  async fetchAllPages(
    url: string,
    pageSize: number,
    resourceType: string,
    logCallback: (message: string, type: LogType) => void
  ): Promise<any[]> {
    let allData: any[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const separator = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${separator}page[number]=${currentPage}&page[size]=${pageSize}`;

      let retries = 5;
      let success = false;

      while (retries > 0 && !success) {
        try {
          await this.waitForCooldown(logCallback);

          const response = await fetch(fullUrl, { headers: this.getHeaders() });

          if (!response.ok) {
            lastErrorTime = Date.now();
            logCallback(
              `API error fetching ${resourceType} page ${currentPage}: ${response.status} ${response.statusText}. Retrying after 120s cooldown...`,
              'error'
            );
            retries--;
            
            if (retries === 0) {
              throw new Error(`API Error after ${5} retries: ${response.status} ${response.statusText}`);
            }
            
            // Continue to next retry attempt (waitForCooldown will handle the 120s pause)
            continue;
          }

          const data = await response.json();
          const pageData = data.data || [];
          allData = allData.concat(pageData);
          totalPages = data.meta?.total_pages || 1;

          logCallback(
            `Fetched ${resourceType} page ${currentPage}/${totalPages} (${pageData.length} items, ${allData.length} total)`,
            'info'
          );

          success = true;
        } catch (err: any) {
          lastErrorTime = Date.now();
          logCallback(
            `Network error fetching ${resourceType} page ${currentPage}: ${err.message}. Retrying after 120s cooldown...`,
            'error'
          );
          retries--;
          
          if (retries === 0) {
            throw new Error(`Failed after ${5} retries: ${err.message}`);
          }
          
          // Continue to next retry attempt (waitForCooldown will handle the 120s pause)
        }
      }

      currentPage++;

      if (currentPage <= totalPages) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return allData;
  }

  async fetchTaskComments(
    taskId: string,
    logCallback: (message: string, type: LogType) => void
  ): Promise<{ commentsString: string; count: number }> {
    const url = `${this.baseUrl}/comments?filter[task_id]=${taskId}`;
    const comments = await this.fetchAllPages(url, 50, `comments for task ${taskId}`, logCallback);

    if (comments.length === 0) {
      return { commentsString: '', count: 0 };
    }

    const commentsString = comments
      .map(comment => {
        const timestamp = comment.attributes?.updated_at || comment.attributes?.created_at || '';
        const body = comment.attributes?.body || '';
        return `[${timestamp}] ${body}`;
      })
      .join(' | ');

    return { commentsString, count: comments.length };
  }
}

export async function processExportJob(
  job: ExportJob,
  updateCallback: (updates: Partial<ExportJob>) => void
): Promise<void> {
  const addLog = (message: string, type: LogType = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog: LogEntry = { timestamp, message, type };
    job.logs.push(newLog);
    updateCallback({ logs: [...job.logs] });
  };

  const updateProgress = (updates: Partial<ExportJob['progress']>) => {
    job.progress = { ...job.progress, ...updates };
    updateCallback({ progress: { ...job.progress } });
  };

  try {
    updateCallback({ status: 'running' });
    const startTime = Date.now();
    updateProgress({ startTime });

    addLog('Starting export process...', 'info');
    const client = new ProductiveApiClient(job.apiToken, job.organizationId);

    addLog(`Fetching tasks for project ${job.projectId}...`, 'info');
    const tasks = await client.fetchAllPages(
      `${client['baseUrl']}/tasks?filter[project_id]=${job.projectId}&include=assignee,creator,last_actor,task_list,parent_task,workflow_status`,
      200,
      'tasks',
      addLog
    );

    updateProgress({ totalTasks: tasks.length });
    addLog(`Total tasks found: ${tasks.length}`, 'success');

    if (tasks.length === 0) {
      addLog('No tasks found for this project', 'error');
      updateCallback({ status: 'failed', error: 'No tasks found for this project' });
      return;
    }

    addLog(`Fetching comments using parallel processing (5 concurrent requests)...`, 'info');

    const tasksWithComments: any[] = [];
    const concurrency = 5;

    for (let i = 0; i < tasks.length; i += concurrency) {
      const chunk = tasks.slice(i, i + concurrency);
      updateProgress({ activeRequests: chunk.length });

      const chunkPromises = chunk.map(async task => {
        const { commentsString, count } = await client.fetchTaskComments(task.id, addLog);
        updateProgress({ commentsProcessed: job.progress.commentsProcessed + count });
        return { ...task, comments: commentsString };
      });

      const chunkResults = await Promise.all(chunkPromises);
      tasksWithComments.push(...chunkResults);

      updateProgress({
        tasksProcessed: tasksWithComments.length,
        activeRequests: 0,
      });

      const percentComplete = Math.round((tasksWithComments.length / tasks.length) * 100);
      addLog(`Progress: ${tasksWithComments.length}/${tasks.length} tasks processed (${percentComplete}%)`, 'success');

      if (i + concurrency < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog(`Finished fetching all comments in ${elapsedTime}s!`, 'success');

    addLog('Generating CSV file...', 'info');
    const csvData = generateCSV(tasksWithComments);

    addLog('CSV ready for download!', 'success');
    updateCallback({
      status: 'completed',
      csvData,
    });
  } catch (err: any) {
    addLog(`Export failed: ${err.message}`, 'error');
    updateCallback({
      status: 'failed',
      error: err.message || 'Unknown error occurred',
    });
  }
}

function generateCSV(tasks: any[]): string {
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Title',
    'Task list',
    'Status',
    'Due date',
    'Assignee',
    'Last activity',
    'Creator',
    'Date',
    'Date closed',
    'Date created',
    'Dependencies',
    'Description',
    'Followers',
    'Last actor',
    'Overdue',
    'Parent task',
    'Planned date',
    'Pricing type',
    'Private',
    'Repeat schedule',
    'Start date',
    'State',
    'Workflow status',
    'Subtasks count',
    'Tags',
    'Task number',
    'Visibility',
    'Todos',
    'Type',
    'Comments',
  ];

  const rows = tasks.map(task => {
    const attrs = task.attributes || {};
    const rels = task.relationships || {};

    return [
      escapeCSV(attrs.title),
      escapeCSV(rels.task_list?.data?.id || ''),
      escapeCSV(rels.workflow_status?.data?.id || ''),
      escapeCSV(attrs.due_date),
      escapeCSV(rels.assignee?.data?.id || ''),
      escapeCSV(attrs.updated_at),
      escapeCSV(rels.creator?.data?.id || ''),
      escapeCSV(attrs.updated_at),
      escapeCSV(attrs.closed_at),
      escapeCSV(attrs.created_at),
      escapeCSV(''),
      escapeCSV(attrs.description),
      escapeCSV(''),
      escapeCSV(rels.last_actor?.data?.id || ''),
      escapeCSV(attrs.closed ? 'No' : attrs.due_date && new Date(attrs.due_date) < new Date() ? 'Yes' : 'No'),
      escapeCSV(rels.parent_task?.data?.id || ''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(''),
      escapeCSV(attrs.repeat_schedule_id || ''),
      escapeCSV(attrs.start_date),
      escapeCSV(attrs.closed ? 'Closed' : 'Open'),
      escapeCSV(rels.workflow_status?.data?.id || ''),
      escapeCSV(attrs.subtask_count || 0),
      escapeCSV(Array.isArray(attrs.tag_list) ? attrs.tag_list.join('; ') : ''),
      escapeCSV(attrs.task_number),
      escapeCSV(attrs.private ? 'Private' : 'Public'),
      escapeCSV(`${attrs.open_todo_count || 0}/${attrs.todo_count || 0}`),
      escapeCSV(attrs.type_id === 1 ? 'Task' : 'Milestone'),
      escapeCSV(task.comments),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
