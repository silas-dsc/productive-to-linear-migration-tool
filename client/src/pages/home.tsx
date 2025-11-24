import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Download, FileText, Loader2, CheckCircle2, AlertCircle, Zap, Activity } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface ProgressStats {
  tasksProcessed: number;
  totalTasks: number;
  commentsProcessed: number;
  activeRequests: number;
  startTime: number;
}

export default function Home() {
  const [apiToken, setApiToken] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<ProgressStats>({
    tasksProcessed: 0,
    totalTasks: 0,
    commentsProcessed: 0,
    activeRequests: 0,
    startTime: 0,
  });
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const fetchAllPages = async (url: string, headers: Record<string, string>, pageSize = 200, resourceType = 'items') => {
    let allData: any[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const separator = url.includes('?') ? '&' : '?';
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(`${url}${separator}page[number]=${currentPage}&page[size]=${pageSize}`)}`;
      
      let retries = 3;
      let response: Response | undefined;
      
      while (retries > 0) {
        try {
          response = await fetch(proxyUrl, { headers });
          if (response.ok) break;
          
          addLog(`Retry fetching ${resourceType} page ${currentPage} (${retries} retries left)`, 'warning');
          retries--;
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err: any) {
          addLog(`Error fetching ${resourceType} page ${currentPage}: ${err.message}`, 'error');
          retries--;
          if (retries === 0) throw err;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!response || !response.ok) {
        const text = await response?.text();
        throw new Error(`API Error: ${response?.status} ${response?.statusText} - ${text}`);
      }

      const data = await response.json();
      const pageData = data.data || [];
      allData = allData.concat(pageData);
      totalPages = data.meta?.total_pages || 1;
      
      addLog(`Fetched ${resourceType} page ${currentPage}/${totalPages} (${pageData.length} items, ${allData.length} total)`, 'info');
      
      currentPage++;

      if (currentPage <= totalPages) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return allData;
  };

  const fetchTaskComments = async (taskId: string, headers: Record<string, string>): Promise<{ commentsString: string; count: number }> => {
    try {
      const baseUrl = `https://api.productive.io/api/v2/comments?filter[task_id]=${taskId}`;
      const comments = await fetchAllPages(baseUrl, headers, 50, `comments for task ${taskId}`);
      
      setProgress(prev => ({ ...prev, commentsProcessed: prev.commentsProcessed + comments.length }));

      if (comments.length === 0) {
        return { commentsString: '', count: 0 };
      }

      const commentsString = comments.map(comment => {
        const timestamp = comment.attributes?.updated_at || comment.attributes?.created_at || '';
        const body = comment.attributes?.body || '';
        return `[${timestamp}] ${body}`;
      }).join(' | ');
      
      return { commentsString, count: comments.length };
    } catch (err: any) {
      addLog(`Error fetching comments for task ${taskId}: ${err.message}`, 'error');
      return { commentsString: '', count: 0 };
    }
  };

  const fetchTaskCommentsInParallel = async (
    tasks: any[],
    headers: Record<string, string>,
    concurrency = 8
  ) => {
    addLog(`Starting parallel comment fetching with ${concurrency} concurrent requests...`, 'info');
    
    const tasksWithComments: any[] = [];
    
    for (let i = 0; i < tasks.length; i += concurrency) {
      const chunk = tasks.slice(i, i + concurrency);
      
      setProgress(prev => ({ ...prev, activeRequests: chunk.length }));
      
      const chunkPromises = chunk.map(async (task) => {
        const { commentsString, count } = await fetchTaskComments(task.id, headers);
        return { ...task, comments: commentsString };
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      tasksWithComments.push(...chunkResults);
      
      setProgress(prev => ({ 
        ...prev, 
        tasksProcessed: tasksWithComments.length,
        activeRequests: 0 
      }));
      
      const percentComplete = Math.round((tasksWithComments.length / tasks.length) * 100);
      addLog(`Progress: ${tasksWithComments.length}/${tasks.length} tasks processed (${percentComplete}%)`, 'success');
      
      if (i + concurrency < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return tasksWithComments;
  };

  const handleExport = async () => {
    if (!apiToken || !organizationId || !projectId) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setLogs([]);
    
    const exportStartTime = Date.now();
    startTimeRef.current = exportStartTime;
    
    setProgress({
      tasksProcessed: 0,
      totalTasks: 0,
      commentsProcessed: 0,
      activeRequests: 0,
      startTime: exportStartTime,
    });

    try {
      addLog('Starting optimized export process...', 'info');
      const headers = {
        'X-Auth-Token': apiToken,
        'X-Organization-Id': organizationId,
        'Content-Type': 'application/vnd.api+json'
      };

      addLog(`Fetching tasks for project ${projectId}...`, 'info');
      const tasks = await fetchAllPages(
        `https://api.productive.io/api/v2/tasks?filter[project_id]=${projectId}&include=assignee,creator,last_actor,task_list,parent_task,workflow_status`,
        headers,
        200,
        'tasks'
      );

      setProgress(prev => ({ ...prev, totalTasks: tasks.length }));
      addLog(`Total tasks found: ${tasks.length}`, 'success');

      if (tasks.length === 0) {
        addLog('No tasks found for this project', 'error');
        setError('No tasks found for this project');
        setLoading(false);
        return;
      }

      addLog(`Fetching comments using parallel processing (8 concurrent requests)...`, 'info');
      const tasksWithComments = await fetchTaskCommentsInParallel(tasks, headers, 8);
      
      const elapsedTime = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
      addLog(`Finished fetching all comments in ${elapsedTime}s!`, 'success');

      addLog('Generating CSV file...', 'info');
      const csvContent = generateCSV(tasksWithComments);

      addLog('Download ready!', 'success');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `productive_tasks_project_${projectId}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccess(`Successfully exported ${tasks.length} tasks with comments in ${elapsedTime}s!`);
    } catch (err: any) {
      console.error('Export error:', err);
      setError(err.message || 'Failed to export tasks. Please check your credentials and try again.');
    } finally {
      setLoading(false);
      setProgress(prev => ({ ...prev, activeRequests: 0 }));
    }
  };

  const generateCSV = (tasks: any[]) => {
    const headers = [
      'Title', 'Task list', 'Status', 'Due date', 'Assignee', 'Last activity',
      'Creator', 'Date', 'Date closed', 'Date created', 'Dependencies',
      'Deployment Approved', 'Description', 'Due date & time', 'ID', 'Last actor',
      'Overdue', 'Parent task', 'Priority', 'Pull Request', 'Pull Request Approved',
      'Repeat schedule', 'Start date', 'Status', 'Status category', 'Subtask',
      'Tags', 'Task number', 'Task privacy', 'To-dos', 'Type', 'Comments'
    ];

    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const rows = tasks.map(task => {
      const attrs = task.attributes || {};
      const rels = task.relationships || {};

      return [
        escapeCSV(attrs.title),
        escapeCSV(rels.task_list?.data?.id || ''),
        escapeCSV(attrs.closed ? 'Closed' : 'Open'),
        escapeCSV(attrs.due_date),
        escapeCSV(rels.assignee?.data?.id || ''),
        escapeCSV(attrs.last_activity_at),
        escapeCSV(rels.creator?.data?.id || ''),
        escapeCSV(attrs.updated_at),
        escapeCSV(attrs.closed_at),
        escapeCSV(attrs.created_at),
        escapeCSV(attrs.task_dependency_count || 0),
        escapeCSV(''),
        escapeCSV(attrs.description),
        escapeCSV(attrs.due_time ? `${attrs.due_date} ${attrs.due_time}` : attrs.due_date),
        escapeCSV(task.id),
        escapeCSV(rels.last_actor?.data?.id || ''),
        escapeCSV(attrs.closed ? 'No' : (attrs.due_date && new Date(attrs.due_date) < new Date() ? 'Yes' : 'No')),
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
        escapeCSV(task.comments)
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  };

  const progressPercentage = progress.totalTasks > 0 
    ? Math.round((progress.tasksProcessed / progress.totalTasks) * 100) 
    : 0;

  const elapsedTime = startTimeRef.current > 0 
    ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1) 
    : '0.0';

  const estimatedTimeRemaining = progress.tasksProcessed > 0 && loading && startTimeRef.current > 0
    ? (((Date.now() - startTimeRef.current) / progress.tasksProcessed) * (progress.totalTasks - progress.tasksProcessed) / 1000).toFixed(1)
    : '0.0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg mb-4">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
            Productive Task Exporter
          </h1>
          <p className="text-lg text-slate-600 flex items-center justify-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Optimized for high-speed parallel processing
          </p>
        </div>

        <Card className="shadow-xl border-slate-200/50 bg-white/80 backdrop-blur">
          <CardHeader className="space-y-2 pb-6">
            <CardTitle className="text-2xl text-slate-900">Export Configuration</CardTitle>
            <CardDescription className="text-base text-slate-600">
              Enter your Productive API credentials and project details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiToken" className="text-sm font-medium text-slate-700">
                  API Token
                </Label>
                <Input
                  id="apiToken"
                  data-testid="input-api-token"
                  type="password"
                  placeholder="Enter your API token"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  disabled={loading}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="organizationId" className="text-sm font-medium text-slate-700">
                  Organization ID
                </Label>
                <Input
                  id="organizationId"
                  data-testid="input-organization-id"
                  type="text"
                  placeholder="Enter organization ID"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  disabled={loading}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="projectId" className="text-sm font-medium text-slate-700">
                  Project ID
                </Label>
                <Input
                  id="projectId"
                  data-testid="input-project-id"
                  type="text"
                  placeholder="Enter project ID"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={loading}
                  className="h-10"
                />
              </div>
            </div>

            <Button
              data-testid="button-export"
              onClick={handleExport}
              disabled={loading || !apiToken || !organizationId || !projectId}
              className="w-full h-10 bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-slate-950 text-white font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Export Tasks
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription data-testid="text-error">{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="border-green-500/50 bg-green-50 text-green-900">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription data-testid="text-success">{success}</AlertDescription>
              </Alert>
            )}

            {loading && progress.totalTasks > 0 && (
              <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">Progress</span>
                    <span className="font-mono text-slate-900" data-testid="text-progress">
                      {progress.tasksProcessed}/{progress.totalTasks} tasks ({progressPercentage}%)
                    </span>
                  </div>
                  <Progress value={progressPercentage} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-500" />
                    <span className="text-slate-600">Active requests:</span>
                    <span className="font-mono font-medium text-slate-900" data-testid="text-active-requests">
                      {progress.activeRequests}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-slate-600">Comments:</span>
                    <span className="font-mono font-medium text-slate-900">
                      {progress.commentsProcessed}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600">Elapsed:</span>
                    <span className="font-mono font-medium text-slate-900">
                      {elapsedTime}s
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600">ETA:</span>
                    <span className="font-mono font-medium text-slate-900">
                      ~{estimatedTimeRemaining}s
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {logs.length > 0 && (
          <Card className="shadow-xl border-slate-200/50 bg-white/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl text-slate-900">Export Log</CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Real-time processing activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div 
                className="max-h-96 overflow-y-auto space-y-1 p-4 bg-slate-950 rounded-md font-mono text-xs"
                data-testid="container-logs"
              >
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className={`${
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'error' ? 'text-red-400' :
                      log.type === 'warning' ? 'text-amber-400' :
                      'text-slate-300'
                    }`}
                  >
                    <span className="text-slate-500">[{log.timestamp}]</span> {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
