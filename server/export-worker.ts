import type { ExportJob, LogEntry, LogType, ExportJobWithLinear } from '@shared/schema';
import { createLinearIssue, addCommentToIssue, addCommentsToIssue, addAttachmentLinkAsComment, createAttachmentFromBuffer, findIssueByTaskUrl, deleteIssue, getTeamStates, archiveIssue, archiveIssues } from './linear-client';

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

  public getHeaders(): Record<string, string> {
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
            `Network error fetching ${resourceType} page ${currentPage}: ${err.message || 'Unknown network error'}. URL: ${fullUrl}. Retrying after 120s cooldown...`,
            'error'
          );
          retries--;
          
          if (retries === 0) {
            throw new Error(`Failed after ${5} retries: ${err.message || 'Unknown network error'}`);
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
  ): Promise<{ comments: any[]; count: number }> {
    const url = `${this.baseUrl}/comments?filter[task_id]=${taskId}`;
    const comments = await this.fetchAllPages(url, 50, `comments for task ${taskId}`, logCallback);
    logCallback(`[DEBUG] Raw comments response for task ${taskId}: ${JSON.stringify(comments, null, 2)}`, 'info');

    if (comments.length === 0) {
      return { comments: [], count: 0 };
    }

    // Sort comments by creation date (oldest first)
    comments.sort((a, b) => {
      const dateA = new Date(a.attributes?.created_at || 0);
      const dateB = new Date(b.attributes?.created_at || 0);
      return dateA.getTime() - dateB.getTime();
    });

    // Cache for person details
    const personCache: Record<string, { name: string; email?: string }> = {};

    // Helper to fetch person details with caching
    const fetchPersonDetails = async (personId: string): Promise<{ name: string; email?: string }> => {
      if (personCache[personId]) return personCache[personId];
      try {
        const personUrl = `${this.baseUrl}/people/${personId}`;
        const res = await fetch(personUrl, { headers: this.getHeaders() });
        if (!res.ok) {
          logCallback(`Failed to fetch person ${personId}: ${res.status} ${res.statusText}`, 'warning');
          return { name: 'Unknown' };
        }
        const data = await res.json();
        logCallback(`[DEBUG] Raw person response for personId ${personId}: ${JSON.stringify(data, null, 2)}`, 'info');
        const attrs = data.data?.attributes || {};
        const name = attrs.name || attrs.full_name || attrs.first_name || 'Unknown';
        const email = attrs.email || undefined;
        personCache[personId] = { name, email };
        return personCache[personId];
      } catch (err: any) {
        logCallback(`Error fetching person ${personId}: ${err.message}`, 'warning');
        return { name: 'Unknown' };
      }
    };

    // Process comments with author names, formatted timestamps and markdown
    const processedComments = await Promise.all(comments.map(async comment => {
      const timestamp = comment.attributes?.created_at || '';
      const formattedTime = formatTimestampToMelbourne(timestamp);
      const body = comment.attributes?.body || '';
      const markdownBody = htmlToPlainText(body);

      // Get person_id from relationships
      let authorName = 'Unknown';
      let authorEmail = undefined;
      const personId = comment.relationships?.person?.data?.id;
      if (personId) {
        const details = await fetchPersonDetails(personId);
        authorName = details.name;
        authorEmail = details.email;
      } else {
        // fallback to attributes.person_name if present
        authorName = comment.attributes?.person_name || 'Unknown';
      }

      let authorLine = `**${authorName}**`;
      if (authorEmail) authorLine += ` <${authorEmail}>`;

      return {
        ...comment,
        formattedBody: `${authorLine} [${formattedTime}]\n${markdownBody}`
      };
    }));

    return { comments: processedComments, count: comments.length };
  }

  /**
   * Download arbitrary URL with Productive auth headers, returning a Buffer and metadata.
   * Returns null on failure.
   */
  async downloadUrlBuffer(url: string, logCallback: (message: string, type: LogType) => void): Promise<{ buffer: Buffer; contentType?: string; filename?: string } | null> {
    try {
      await this.waitForCooldown(logCallback);
      const res = await fetch(url, { headers: this.getHeaders() as any });

      if (!res.ok) {
        logCallback(`Failed to download ${url}: ${res.status} ${res.statusText}`, 'warning');
        return null;
      }

      const contentType = res.headers.get('content-type') || '';
      
      // Check if we got an HTML response instead of the expected file
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        logCallback(`Download returned ${contentType} instead of binary file for ${url}. This might indicate authentication issues or the URL is not a direct file link.`, 'warning');
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Additional validation: check if buffer looks like HTML
      const bufferStart = buffer.subarray(0, Math.min(100, buffer.length)).toString('utf8').toLowerCase();
      if (bufferStart.includes('<html') || bufferStart.includes('<!doctype') || bufferStart.includes('<body')) {
        logCallback(`Downloaded content appears to be HTML instead of a file for ${url}. Skipping upload.`, 'warning');
        return null;
      }

      // Try to infer filename from Content-Disposition or URL path
      let filename: string | undefined;
      const cd = res.headers.get('content-disposition');
      if (cd) {
        const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(cd);
        if (m) filename = decodeURIComponent(m[1]);
      }
      if (!filename) {
        try {
          const parsed = new URL(url);
          const p = parsed.pathname.split('/').pop();
          if (p) filename = decodeURIComponent(p);
        } catch {
          // ignore
        }
      }
      return { buffer, contentType, filename };
    } catch (err: any) {
      logCallback(`Error downloading ${url}: ${err.message}`, 'warning');
      lastErrorTime = Date.now();
      return null;
    }
  }
}

// Helper function to determine if a URL is likely an attachment (file) rather than a web page
function isLikelyAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    
    // Skip avatar/profile images - these often require special authentication
    if (pathname.includes('/avatar') || pathname.includes('/profile') || parsed.hostname === 'files.productive.io') {
      return false;
    }
    
    // Check for common file extensions
    const fileExtensions = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg',
      '.mp4', '.avi', '.mov', '.mp3', '.wav',
      '.zip', '.rar', '.7z', '.tar', '.gz',
      '.txt', '.csv', '.json', '.xml'
    ];
    
    if (fileExtensions.some(ext => pathname.includes(ext))) {
      return true;
    }
    
    // Check for known file hosting domains
    const fileDomains = [
      'drive.google.com',
      'docs.google.com',
      'dropbox.com',
      'onedrive.live.com',
      'box.com',
      'mega.nz',
      'mediafire.com',
      'app.productive.io' // Productive's own attachments
    ];
    
    if (fileDomains.some(domain => parsed.hostname.includes(domain))) {
      return true;
    }
    
    // Exclude known web page domains that are unlikely to host attachments
    const pageDomains = [
      'notion.site',
      'github.com',
      'gitlab.com',
      'bitbucket.org',
      'stackoverflow.com',
      'reddit.com',
      'twitter.com',
      'facebook.com',
      'linkedin.com',
      'youtube.com',
      'vimeo.com'
    ];
    
    if (pageDomains.some(domain => parsed.hostname.includes(domain))) {
      return false;
    }
    
    // If no extension and not a known domain, assume it's a web page
    return false;
  } catch {
    // Invalid URL, skip
    return false;
  }
}

// Helper function to convert HTML to plain text with proper formatting
function htmlToPlainText(html: string): string {
  if (!html) return '';
  
  // First, handle tables - convert to markdown table format
  html = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
    const rows = [];
    // Extract table rows
    const rowMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    
    for (const rowMatch of rowMatches) {
      const cells = [];
      // Extract table cells (both td and th)
      const cellMatches = rowMatch.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
      
      for (const cellMatch of cellMatches) {
        // Remove inner HTML tags but keep text
        const cellText = cellMatch.replace(/<[^>]+>/g, '').trim();
        cells.push(cellText);
      }
      
      if (cells.length > 0) {
        rows.push('| ' + cells.join(' | ') + ' |');
      }
    }
    
    // Add separator row after header
    if (rows.length > 0) {
      const separator = '|' + ' --- |'.repeat(rows[0].split('|').length - 1);
      rows.splice(1, 0, separator);
    }
    
    return rows.join('\n') + '\n\n';
  });
  
  // Handle ordered lists - convert to 1. 2. 3. format
  let listCounter = 1;
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, listContent) => {
    const items = [];
    const itemMatches = listContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    
    for (const itemMatch of itemMatches) {
      const itemText = itemMatch.replace(/<li[^>]*>/i, '').replace(/<\/li>/i, '').trim();
      // Recursively process nested content
      const processedItem = htmlToPlainText(itemText);
      items.push(`${listCounter}. ${processedItem}`);
      listCounter++;
    }
    
    return items.join('\n') + '\n\n';
  });
  
  // Handle unordered lists - convert to - format
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, listContent) => {
    const items = [];
    const itemMatches = listContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    
    for (const itemMatch of itemMatches) {
      const itemText = itemMatch.replace(/<li[^>]*>/i, '').replace(/<\/li>/i, '').trim();
      // Recursively process nested content
      const processedItem = htmlToPlainText(itemText);
      items.push(`- ${processedItem}`);
    }
    
    return items.join('\n') + '\n\n';
  });
  
  // Handle remaining list items (in case they're not properly wrapped)
  html = html.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (match, content) => {
    const processedContent = htmlToPlainText(content);
    return `- ${processedContent}\n`;
  });
  
  // Handle basic formatting
  html = html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '__$1__')
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br[^>]*\/?>/gi, '\n')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n')
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n')
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n')
    // Parse Productive mentions like @[{"type":"person","id":"290328","label":"Tom Claasz",...}]
    .replace(/@\[(\{[^}]+\})\]/g, (match, jsonStr) => {
      try {
        const mentionData = JSON.parse(jsonStr);
        if (mentionData.type === 'person' && mentionData.label) {
          return mentionData.label;
        }
      } catch (e) {
        // If parsing fails, return the original
      }
      return match;
    })
    // Handle cc @ mentions
    .replace(/cc\s+@\[(\{[^}]+\})\]/g, (match, jsonStr) => {
      try {
        const mentionData = JSON.parse(jsonStr);
        if (mentionData.type === 'person' && mentionData.label) {
          return `cc: ${mentionData.label}`;
        }
      } catch (e) {
        // If parsing fails, return the original
      }
      return match;
    });
  
  // Remove all remaining HTML tags
  html = html.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  html = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&bull;/g, '•')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"');
  
  // Clean up extra whitespace
  html = html
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ') // Multiple spaces/tabs to single space
    .trim();
  
  return html;
}

// Helper function to format timestamp to Melbourne timezone
function formatTimestampToMelbourne(timestamp: string): string {
  if (!timestamp) return '';
  
  try {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return timestamp; // fallback to original if parsing fails
  }
}

// Helper function to map Productive workflow status to Linear state
function mapProductiveStatusToLinearState(
  productiveStatus: any,
  linearStates: any[],
  logCallback: (message: string, type: LogType) => void
): { stateId: string | undefined; shouldArchive: boolean } {
  if (!productiveStatus || !productiveStatus.attributes) {
    return { stateId: undefined, shouldArchive: false };
  }

  const statusName = productiveStatus.attributes.name?.toLowerCase() || '';
  const statusType = productiveStatus.attributes.type?.toLowerCase() || '';

  // Check if this is a completed/cancelled status that should be archived
  const archiveStatuses = ['done', 'closed', 'cancelled', 'cancel', 'completed', 'finished', 'resolved', 'complete'];
  
  const isArchiveStatus = archiveStatuses.some(s => 
    statusName === s || 
    statusName.startsWith(s) || 
    statusType === s || 
    statusType.startsWith(s) ||
    // Handle common variations
    (statusName.includes(s) && (statusName.length - s.length) <= 2)
  );
  
  if (isArchiveStatus) {
    logCallback(`Status "${productiveStatus.attributes.name}" indicates completion - will archive issue`, 'info');
    return { stateId: undefined, shouldArchive: true };
  }

  // Map common status names to Linear states
  const statusMappings: { [key: string]: string[] } = {
    'backlog': ['backlog', 'todo', 'to do', 'open'],
    'in progress': ['in progress', 'in_progress', 'doing', 'active', 'started', 'working'],
    'in review': ['in review', 'review', 'reviewing', 'qa', 'testing'],
    'done': ['done', 'completed', 'finished', 'resolved']
  };

  for (const [linearState, productiveNames] of Object.entries(statusMappings)) {
    if (productiveNames.some(name => statusName.includes(name))) {
      // Find the corresponding Linear state
      const linearStateObj = linearStates.find(state => 
        state.name.toLowerCase().includes(linearState) ||
        state.type.toLowerCase() === linearState.replace(' ', '_')
      );
      
      if (linearStateObj) {
        logCallback(`Mapped Productive status "${productiveStatus.attributes.name}" to Linear state "${linearStateObj.name}"`, 'info');
        return { stateId: linearStateObj.id, shouldArchive: false };
      }
    }
  }

  // Default to Backlog if no mapping found
  const backlogState = linearStates.find(state => 
    state.name.toLowerCase().includes('backlog') || 
    state.type.toLowerCase() === 'backlog'
  );
  
  if (backlogState) {
    logCallback(`No mapping found for Productive status "${productiveStatus.attributes.name}" - defaulting to "${backlogState.name}"`, 'info');
    return { stateId: backlogState.id, shouldArchive: false };
  }

  logCallback(`No suitable Linear state found for Productive status "${productiveStatus.attributes.name}"`, 'warning');
  return { stateId: undefined, shouldArchive: false };
}

export async function processExportJob(
  job: ExportJobWithLinear,
  updateCallback: (updates: Partial<ExportJobWithLinear>) => void
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
    let tasks = await client.fetchAllPages(
      `${client['baseUrl']}/tasks?filter[project_id]=${job.projectId}&include=assignee,creator,last_actor,task_list,parent_task,workflow_status`,
      200,
      'tasks',
      addLog
    );

    updateProgress({ totalTasks: tasks.length });
    addLog(`Total tasks found: ${tasks.length}`, 'success');

    // Fetch workflow statuses for status mapping
    addLog('Fetching workflow statuses for status mapping...', 'info');
    let workflowStatuses: any[] = [];
    if (tasks.length > 0) {
      // Get workflow ID from the first task's workflow status
      const firstTask = tasks[0];
      const workflowStatusId = firstTask.relationships?.workflow_status?.data?.id;
      if (workflowStatusId) {
        try {
          // Fetch the workflow status with workflow included
          const workflowStatusUrl = `${client['baseUrl']}/workflow_statuses/${workflowStatusId}?include=workflow`;
          const workflowStatusResponse = await fetch(workflowStatusUrl, { headers: client.getHeaders() });
          if (workflowStatusResponse.ok) {
            const workflowStatusData = await workflowStatusResponse.json();
            const workflowId = workflowStatusData.data?.relationships?.workflow?.data?.id;
            if (workflowId) {
              const url = `${client['baseUrl']}/workflow_statuses?filter[workflow_id]=${workflowId}`;
              workflowStatuses = await client.fetchAllPages(url, 50, 'workflow statuses', addLog);
            } else {
              addLog('Could not determine workflow ID from workflow status', 'warning');
            }
          } else {
            addLog(`Failed to fetch workflow status: ${workflowStatusResponse.status}`, 'warning');
          }
        } catch (err: any) {
          addLog(`Error fetching workflow status: ${err.message}`, 'warning');
        }
      } else {
        addLog('Could not determine workflow status ID from tasks', 'warning');
      }
    } else {
      addLog('No tasks found, cannot fetch workflow statuses', 'warning');
    }
    addLog(`Found ${workflowStatuses.length} workflow statuses`, 'info');

    // If the user requested only-not-done tasks, filter them out early to avoid processing them
    if (job.onlyNotDoneTasks) {
      addLog('Excluding completed/cancelled tasks from initial task list...', 'info');
      const originalCount = tasks.length;
      const doneStatuses = ['done', 'closed', 'cancelled', 'cancel', 'completed', 'finished', 'resolved', 'complete'];

      tasks = tasks.filter(task => {
        const workflowStatusId = task.relationships?.workflow_status?.data?.id;
        const workflowStatus = workflowStatuses.find(ws => ws.id === workflowStatusId);

        if (!workflowStatus || !workflowStatus.attributes) {
          // If we can't determine the status, keep the task
          return true;
        }

        const statusName = (workflowStatus.attributes.name || '').toLowerCase().trim();
        const statusType = (workflowStatus.attributes.type || '').toLowerCase().trim();

        const isDone = doneStatuses.some(s =>
          statusName === s ||
          statusName.startsWith(s) ||
          statusType === s ||
          statusType.startsWith(s) ||
          (statusName.includes(s) && (statusName.length - s.length) <= 2)
        );

        if (isDone) {
          addLog(`Excluding task "${task.attributes?.title}" with state "${workflowStatus.attributes.name}"`, 'info');
          return false;
        }

        return true;
      });

      const filteredOut = originalCount - tasks.length;
      addLog(`Excluded ${filteredOut} completed/cancelled tasks. Remaining tasks: ${tasks.length}`, 'info');
      updateProgress({ totalTasks: tasks.length });
    }

    // In test mode, limit to first 10 tasks that have both description and comments
    if (job.testMode) {
      addLog('Test mode: filtering for tasks with description and comments...', 'info');
      
      // First filter tasks that have a description
      let tasksWithDescription = tasks.filter(task => 
        task.attributes?.description?.trim()
      );
      
      // Apply onlyNotDoneTasks filter if needed (before looking for comments)
      if (job.onlyNotDoneTasks) {
        addLog('Test mode: also filtering out completed/cancelled tasks...', 'info');
        tasksWithDescription = tasksWithDescription.filter(task => {
          const workflowStatusId = task.relationships?.workflow_status?.data?.id;
          const workflowStatus = workflowStatuses.find(ws => ws.id === workflowStatusId);
          
          if (!workflowStatus || !workflowStatus.attributes) {
            return true; // Keep task if we can't determine status
          }

          const statusName = (workflowStatus.attributes.name || '').toLowerCase().trim();
          const statusType = (workflowStatus.attributes.type || '').toLowerCase().trim();
          const doneStatuses = ['done', 'closed', 'cancelled', 'cancel', 'completed', 'finished', 'resolved', 'complete'];
          
          return !doneStatuses.some(s => 
            statusName === s || 
            statusName.startsWith(s) || 
            statusType === s || 
            statusType.startsWith(s) ||
            (statusName.includes(s) && (statusName.length - s.length) <= 2)
          );
        });
      }
      
      addLog(`Found ${tasksWithDescription.length} tasks with descriptions`, 'info');
      
      // Then check for comments on these tasks until we find 3 with both
      const tasksWithBoth: any[] = [];
      for (const task of tasksWithDescription) {
        if (tasksWithBoth.length >= 3) break;
        
        try {
          const { count } = await client.fetchTaskComments(task.id, addLog);
          if (count > 0) {
            tasksWithBoth.push(task);
          }
        } catch (err: any) {
          addLog(`Error checking comments for task ${task.id}: ${err.message}`, 'warning');
        }
      }
      
      tasks = tasksWithBoth;
      addLog(`Test mode: limited to ${tasks.length} tasks with both description and comments`, 'info');
    }

    // Filter out "done" tasks if requested
    if (job.onlyNotDoneTasks) {
      addLog('Filtering out completed/cancelled tasks...', 'info');
      const originalCount = tasks.length;
      
      tasks = tasks.filter(task => {
        const workflowStatusId = task.relationships?.workflow_status?.data?.id;
        const workflowStatus = workflowStatuses.find(ws => ws.id === workflowStatusId);
        
        if (!workflowStatus || !workflowStatus.attributes) {
          addLog(`Could not determine status for task "${task.attributes?.title}" - keeping it`, 'warning');
          return true; // Keep task if we can't determine status
        }

        const statusName = (workflowStatus.attributes.name || '').toLowerCase().trim();
        const statusType = (workflowStatus.attributes.type || '').toLowerCase().trim();

        // Check if this is a completed/cancelled status - be more specific to avoid false positives
        const doneStatuses = ['done', 'closed', 'cancelled', 'cancel', 'completed', 'finished', 'resolved', 'complete'];
        
        // Check for exact matches, starts with, or common variations
        const isDoneStatus = doneStatuses.some(s => 
          statusName === s || 
          statusName.startsWith(s) || 
          statusType === s || 
          statusType.startsWith(s) ||
          // Handle common variations like "Done" -> "done", "Completed" -> "completed"
          statusName.includes(s) && (statusName.length - s.length) <= 2 // Allow small differences
        );

        if (isDoneStatus) {
          addLog(`Filtering out task "${task.attributes?.title}" with status "${workflowStatus.attributes.name}"`, 'info');
          return false; // Filter out done tasks
        }

        return true; // Keep non-done tasks
      });
      
      const filteredCount = originalCount - tasks.length;
      addLog(`Filtered out ${filteredCount} completed/cancelled tasks. Remaining: ${tasks.length}`, 'info');
    }

    if (tasks.length === 0) {
      addLog('No tasks found for this project', 'error');
      updateCallback({ status: 'failed', error: 'No tasks found for this project' });
      return;
    }

    addLog(`Fetching comments using parallel processing (5 concurrent requests)...`, 'info');

    let allTasksWithComments: any[] = [];
    const concurrency = 5;
    let linearApiKey: string | null = null;
    let linearIssuesCreated = 0;
    let linearStates: any[] = [];

    // Initialize Linear integration if requested
    if (job.importToLinear && job.linearTeamId && job.linearApiKey?.trim()) {
      linearApiKey = job.linearApiKey;
      addLog(`Linear integration enabled for team ${job.linearTeamId}`, 'info');
      addLog(`Linear API key present: ${!!linearApiKey}`, 'info');

      // Fetch Linear team states for status mapping
      try {
        linearStates = await getTeamStates(linearApiKey, job.linearTeamId);
        addLog(`Fetched ${linearStates.length} Linear states for team`, 'info');
      } catch (err: any) {
        addLog(`Failed to fetch Linear states: ${err.message}`, 'warning');
        linearStates = [];
      }
    } else {
      addLog(`Linear integration not enabled: importToLinear=${job.importToLinear}, teamId=${!!job.linearTeamId}, apiKey=${!!job.linearApiKey?.trim()}`, 'warning');
    }

    // Process tasks in chunks, creating Linear issues as we go
    for (let i = 0; i < tasks.length; i += concurrency) {
      const chunk = tasks.slice(i, i + concurrency);
      updateProgress({ activeRequests: chunk.length });

      const chunkPromises = chunk.map(async task => {
        // Check if job should stop
        if ((job as any).shouldStop) {
          addLog('Export stopped by user', 'warning');
          throw new Error('Export stopped by user');
        }

        const { comments, count } = await client.fetchTaskComments(task.id, addLog);
        updateProgress({ commentsProcessed: job.progress.commentsProcessed + count });
        const taskWithComments = { 
          ...task, 
          comments: comments.map(c => c.formattedBody).join(' | '),
          commentObjects: comments
        };

        // Create Linear issue if integration enabled
        if (linearApiKey && job.linearTeamId) {
          console.log('[Export Worker] About to create Linear issue for task:', task.id, task.attributes?.title);
          try {
            console.log('[Export Worker] Creating Linear issue for task:', task.attributes?.title);

            const title = (task.attributes?.title?.trim() || 'Untitled').substring(0, 255);
            const taskUrl = task.links?.self || `https://app.productive.io/${job.organizationId}/tasks/${task.id}`;
            const description = `${htmlToPlainText(task.attributes?.description || '').trim()}\n\n---\nProductive task link: ${taskUrl}\n`;

            console.log('[Export Worker] Title:', JSON.stringify(title), 'Description length:', description.length);

            // Check if issue already exists for this task (unless skipping duplicate check)
            if (!job.skipDuplicateCheck) {
              const existingIssue = await findIssueByTaskUrl(linearApiKey, job.linearTeamId, taskUrl);
              if (existingIssue) {
                addLog(`Found existing Linear issue ${existingIssue.identifier} for task "${task.attributes?.title}", deleting and re-creating...`, 'info');
                await deleteIssue(linearApiKey, existingIssue.id);
              }
            } else {
              addLog(`Skipping duplicate check for task "${task.attributes?.title}"`, 'info');
            }

            // Map Productive status to Linear state
            const workflowStatusId = task.relationships?.workflow_status?.data?.id;
            const workflowStatus = workflowStatuses.find(ws => ws.id === workflowStatusId);
            const { stateId, shouldArchive } = mapProductiveStatusToLinearState(workflowStatus, linearStates, addLog);

            const created = await createLinearIssue(linearApiKey, job.linearTeamId, title, description, stateId);
            console.log('[Export Worker] createLinearIssue returned:', created);

            if (created && created.id) {
              linearIssuesCreated++;
              addLog(`Processed Linear issue ${created.identifier || created.id} for task "${task.attributes?.title}"`, 'success');

              // Add comments if any (before archiving) - reversed so oldest is created first
              if (taskWithComments.commentObjects && taskWithComments.commentObjects.length > 0) {
                const commentBodies = taskWithComments.commentObjects.reverse().map((c: any) => c.formattedBody);
                const success = await addCommentsToIssue(linearApiKey, created.id, commentBodies);
                if (success) {
                  addLog(`Added ${taskWithComments.commentObjects.length} comments to Linear issue ${created.identifier || created.id}`, 'info');
                } else {
                  addLog(`Some comments may have failed to add to Linear issue ${created.identifier || created.id}`, 'warning');
                }
              }

              // Track URLs that have been processed for this issue to avoid duplicates
              const processedUrls = new Set<string>();
              
              // Collect all URLs already mentioned in comments to avoid duplicate attachment links
              const commentUrls = new Set<string>();
              if (taskWithComments.commentObjects) {
                for (const comment of taskWithComments.commentObjects) {
                  const commentText = comment.formattedBody || '';
                  const urlsInComment = commentText.match(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g) || [];
                  urlsInComment.forEach((url: string) => commentUrls.add(url));
                }
              }

              // If task description or comments contain attachment URLs, try to download and upload them
              const textToScan = `${task.attributes?.description || ''}\n${taskWithComments.comments || ''}`;
              const urlRegex = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g;
              const urls = Array.from(new Set((textToScan.match(urlRegex) || [])));
              for (const url of urls) {
                // Skip if we've already processed this URL for this issue
                if (processedUrls.has(url)) {
                  continue;
                }
                processedUrls.add(url);

                // Skip URLs that are unlikely to be attachments (web pages, etc.)
                if (!isLikelyAttachmentUrl(url)) {
                  // Skip if this URL is already mentioned in comments
                  if (commentUrls.has(url)) {
                    addLog(`Skipping attachment link for ${url} - already mentioned in comments`, 'info');
                    continue;
                  }
                  
                  addLog(`Skipping non-attachment URL: ${url}`, 'info');
                  // Still add as comment to preserve the link
                  await addAttachmentLinkAsComment(linearApiKey, created.id, url);
                  addLog(`Attached link ${url} to Linear issue ${created.identifier || created.id}`, 'info');
                  continue;
                }

                try {
                  // First try to download the URL with Productive auth (if it's a Productive-hosted URL)
                  const downloaded = await client.downloadUrlBuffer(url, addLog);
                  if (downloaded && downloaded.buffer) {
                    try {
                      const filename = downloaded.filename || `attachment`;
                      const contentType = downloaded.contentType;
                      const attachment = await createAttachmentFromBuffer(linearApiKey, created.id, downloaded.buffer, filename, contentType);
                      if (attachment && attachment.id) {
                        addLog(`Uploaded attachment ${filename} to Linear issue ${created.identifier || created.id}`, 'info');
                        continue; // success for this URL
                      }
                    } catch (uploadErr: any) {
                      addLog(`Binary upload failed for ${url}: ${uploadErr.message}`, 'warning');
                      // continue to fallback below
                    }
                  }

                  // If download or upload didn't work, try to create an attachment record via URL (if Linear supports)
                  try {
                    const attachmentRecord = await (await import('./linear-client')).createAttachment(linearApiKey, created.id, url, undefined);
                    if (attachmentRecord && attachmentRecord.id) {
                      addLog(`Created attachment record for ${url} on Linear issue ${created.identifier || created.id}`, 'info');
                      continue;
                    }
                  } catch (innerErr: any) {
                    // creation via URL not supported or failed, fall back to comment
                  }

                  // Fallback: add the URL as a comment so the link is preserved
                  await addAttachmentLinkAsComment(linearApiKey, created.id, url);
                  addLog(`Attached link ${url} to Linear issue ${created.identifier || created.id}`, 'info');
                } catch (attachErr: any) {
                  addLog(`Failed to attach ${url}: ${attachErr.message}`, 'warning');
                }
              }

              // Return issue info for potential batch archiving
              return { 
                taskWithComments, 
                issueId: created.id, 
                issueIdentifier: created.identifier || created.id,
                shouldArchive 
              };
            } else {
              addLog(`Failed to create Linear issue for task "${task.attributes?.title}"`, 'error');
              return { taskWithComments, issueId: null, issueIdentifier: null, shouldArchive: false };
            }
          } catch (err: any) {
            console.error('[Export Worker] Error creating Linear issue:', err);

            // Check if this is a rate limit error
            if (err.message?.includes('Rate limit exceeded') || err.message?.includes('RATELIMITED')) {
              addLog(`Linear API rate limit exceeded. The export will automatically retry after the limit resets (typically 1 hour). Please wait...`, 'warning');
            } else {
              addLog(`Error creating Linear issue: ${err.message}`, 'error');
            }
            return { taskWithComments, issueId: null, issueIdentifier: null, shouldArchive: false };
          }
        }

        return { taskWithComments, issueId: null, issueIdentifier: null, shouldArchive: false };
      });

      const chunkResults = await Promise.all(chunkPromises);

      // Batch archive issues that need archiving
      const issuesToArchive = chunkResults
        .filter(result => result.issueId && result.shouldArchive)
        .map(result => result.issueId);

      if (issuesToArchive.length > 0 && linearApiKey) {
        try {
          const archiveResults = await archiveIssues(linearApiKey, issuesToArchive);
          const successfulArchives = archiveResults.filter(Boolean).length;
          addLog(`Batch archived ${successfulArchives}/${issuesToArchive.length} Linear issues`, 'info');
        } catch (err: any) {
          addLog(`Batch archiving failed: ${err.message}`, 'warning');
        }
      }

      const chunkTasks = chunkResults.map(result => result.taskWithComments);
      allTasksWithComments = allTasksWithComments.concat(chunkTasks);

      updateProgress({
        tasksProcessed: allTasksWithComments.length,
        activeRequests: 0,
      });

      const percentComplete = Math.round((allTasksWithComments.length / tasks.length) * 100);
      const linearStatus = linearApiKey ? ` | ${linearIssuesCreated} Linear issues created` : '';
      addLog(`Progress: ${allTasksWithComments.length}/${tasks.length} tasks processed (${percentComplete}%)${linearStatus}`, 'success');

      if (i + concurrency < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog(`Finished processing all comments in ${elapsedTime}s!`, 'success');

    // Generate CSV
    addLog('Generating CSV file...', 'info');
    const csvData = generateCSV(allTasksWithComments);
    addLog('CSV ready for download!', 'success');

    if (job.importToLinear && job.linearTeamId) {
      addLog(`Linear import complete: ${linearIssuesCreated}/${allTasksWithComments.length} tasks imported`, 'success');
    }

    updateCallback({
      status: 'completed',
      csvData,
      linearIssuesCreated,
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
