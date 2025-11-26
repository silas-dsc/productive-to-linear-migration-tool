import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Download, FileText, Loader2, CheckCircle2, AlertCircle, Zap, Activity } from 'lucide-react';
import type { LogEntry, ProgressStats } from '@shared/schema';

export default function Home() {
  // Initialize with empty state
  const [apiToken, setApiToken] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [importToLinear, setImportToLinear] = useState(false);
  const [linearTeamId, setLinearTeamId] = useState('');
  const [linearApiKey, setLinearApiKey] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);
  const [onlyNotDoneTasks, setOnlyNotDoneTasks] = useState(false);
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const reconnectToJob = async (jobId: string) => {
    try {
      // Check if job still exists and get its current status
      const response = await fetch(`/api/export/${jobId}/status`);
      if (!response.ok) {
        if (response.status === 404) {
          // Job not found, clear localStorage
          localStorage.removeItem('productive-export-job-id');
          return;
        }
        throw new Error('Failed to check job status');
      }

      const job = await response.json();
      setJobId(jobId);
      setJobStatus(job.status);
      setLogs(job.logs);
      setProgress(job.progress);

      if (job.status === 'completed') {
        setSuccess('Export completed! You can download the CSV file below.');
        localStorage.removeItem('productive-export-job-id');
        return;
      } else if (job.status === 'failed') {
        setError(job.error || 'Export failed');
        localStorage.removeItem('productive-export-job-id');
        return;
      }

      // Job is still running, reconnect to SSE
      setLoading(true);
      setError('');
      setSuccess('');

      const eventSource = new EventSource(`/api/export/${jobId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'init' || data.type === 'update') {
          const currentJob = data.job;
          setJobStatus(currentJob.status);
          setLogs(currentJob.logs);
          setProgress(currentJob.progress);

          if (currentJob.status === 'completed') {
            setSuccess('Export completed! You can download the CSV file below.');
            setLoading(false);
            eventSource.close();
            localStorage.removeItem('productive-export-job-id');
          } else if (currentJob.status === 'failed') {
            setError(currentJob.error || 'Export failed');
            setLoading(false);
            eventSource.close();
            localStorage.removeItem('productive-export-job-id');
          }
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE reconnection error:', error);
        eventSource.close();
        // Don't clear loading state here - job might still be running
        setError('Connection lost. The export may still be running in the background.');
      };

    } catch (err: any) {
      console.error('Failed to reconnect to job:', err);
      localStorage.removeItem('productive-export-job-id');
      setError('Failed to reconnect to previous export job.');
    }
  };

  // Load environment variables and check for existing job on mount
  useEffect(() => {
    console.log('Loading environment variables...', {
      VITE_PRODUCTIVE_API_TOKEN: import.meta.env.VITE_PRODUCTIVE_API_TOKEN ? '***' : 'NOT SET',
      VITE_PRODUCTIVE_ORG_ID: import.meta.env.VITE_PRODUCTIVE_ORG_ID,
      VITE_PRODUCTIVE_PROJECT_ID: import.meta.env.VITE_PRODUCTIVE_PROJECT_ID,
      VITE_LINEAR_TEAM_ID: import.meta.env.VITE_LINEAR_TEAM_ID,
      VITE_LINEAR_API_KEY: import.meta.env.VITE_LINEAR_API_KEY ? '***' : 'NOT SET',
      VITE_IMPORT_TO_LINEAR: import.meta.env.VITE_IMPORT_TO_LINEAR,
    });
    
    setApiToken(import.meta.env.VITE_PRODUCTIVE_API_TOKEN || '');
    setOrganizationId(import.meta.env.VITE_PRODUCTIVE_ORG_ID || '');
    setProjectId(import.meta.env.VITE_PRODUCTIVE_PROJECT_ID || '');
    setImportToLinear(import.meta.env.VITE_IMPORT_TO_LINEAR === 'true' || false);
    setLinearTeamId(import.meta.env.VITE_LINEAR_TEAM_ID || '');
    setLinearApiKey(import.meta.env.VITE_LINEAR_API_KEY || '');
    setTestMode(import.meta.env.VITE_TEST_MODE === 'true' || false);

    // Check for existing running job
    const existingJobId = localStorage.getItem('productive-export-job-id');
    if (existingJobId) {
      console.log('Found existing job ID:', existingJobId);
      reconnectToJob(existingJobId);
    }
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleStop = async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/export/${jobId}/stop`, { method: 'POST' });
      setLoading(false);
    } catch (err) {
      console.error('Failed to stop export:', err);
    }
  };

  const handleExport = async () => {
    if (!apiToken || !organizationId || !projectId) {
      setError('Please fill in all fields');
      return;
    }

    if (importToLinear && !linearTeamId) {
      setError('Linear team id is required when importing to Linear');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setLogs([]);
    setJobId(null);
    setJobStatus('');
    
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
      // Start the export job
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          apiToken, 
            organizationId, 
            projectId, 
            importToLinear, 
            linearTeamId,
            linearApiKey,
            testMode,
            skipDuplicateCheck,
            onlyNotDoneTasks,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start export');
      }

      const { jobId: newJobId } = await response.json();
      setJobId(newJobId);

      // Connect to SSE stream for real-time updates
      const eventSource = new EventSource(`/api/export/${newJobId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'init' || data.type === 'update') {
          const job = data.job;
          setJobStatus(job.status);
          setLogs(job.logs);
          setProgress(job.progress);

          if (job.status === 'completed') {
            const elapsedTime = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
            setSuccess(`Export completed in ${elapsedTime}s! Downloading...`);
            setLoading(false);
            eventSource.close();
            // Auto-download the CSV file
            setTimeout(() => {
              window.location.href = `/api/export/${newJobId}/download`;
            }, 500);
          } else if (job.status === 'failed') {
            setError(job.error || 'Export failed');
            setLoading(false);
            eventSource.close();
          }
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (jobStatus !== 'completed' && jobStatus !== 'failed') {
          setError('Connection lost. Refresh the page to check status.');
          setLoading(false);
        }
      };

    } catch (err: any) {
      console.error('Export error:', err);
      setError(err.message || 'Failed to start export. Please check your credentials and try again.');
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!jobId) return;
    window.location.href = `/api/export/${jobId}/download`;
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
            Productive to Linear Importer
          </h1>
          <p className="text-lg text-slate-600 flex items-center justify-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Export Productive tasks and import to Linear
          </p>
        </div>

        <Card className="shadow-xl border-slate-200/50 bg-white/80 backdrop-blur">
          <CardHeader className="space-y-2 pb-6">
            <CardTitle className="text-2xl text-slate-900">Configuration</CardTitle>
            <CardDescription className="text-base text-slate-600">
              Enter your Productive and Jira credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-700">Productive.io Credentials</h3>
                <div className="space-y-2">
                  <Label htmlFor="apiToken" className="text-sm font-medium text-slate-700">
                    API Token
                  </Label>
                  <Input
                    id="apiToken"
                    data-testid="input-api-token"
                    type="password"
                    placeholder="Enter your Productive API token"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    disabled={loading}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organizationId" className="text-sm font-medium text-slate-700">
                    Organization ID
                  </Label>
                  <Input
                    id="organizationId"
                    data-testid="input-organization-id"
                    placeholder="Enter organization ID"
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    disabled={loading}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projectId" className="text-sm font-medium text-slate-700">
                    Project ID
                  </Label>
                  <Input
                    id="projectId"
                    data-testid="input-project-id"
                    placeholder="Enter project ID"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    disabled={loading}
                    className="h-11"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-700">Linear Import Credentials</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="importToLinear"
                        data-testid="checkbox-import-linear"
                        type="checkbox"
                        checked={importToLinear}
                        onChange={(e) => setImportToLinear(e.target.checked)}
                        disabled={loading}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="importToLinear" className="text-sm font-medium text-slate-700 cursor-pointer">
                        Import tasks to Linear
                      </Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="testMode"
                        data-testid="checkbox-test-mode"
                        type="checkbox"
                        checked={testMode}
                        onChange={(e) => setTestMode(e.target.checked)}
                        disabled={loading}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="testMode" className="text-sm font-medium text-slate-700 cursor-pointer">
                        Test mode (first 3 tasks only)
                      </Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="skipDuplicateCheck"
                        data-testid="checkbox-skip-duplicate-check"
                        type="checkbox"
                        checked={skipDuplicateCheck}
                        onChange={(e) => setSkipDuplicateCheck(e.target.checked)}
                        disabled={loading}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="skipDuplicateCheck" className="text-sm font-medium text-slate-700 cursor-pointer">
                        Skip duplicate check (faster import)
                      </Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        id="onlyNotDoneTasks"
                        data-testid="checkbox-only-not-done"
                        type="checkbox"
                        checked={onlyNotDoneTasks}
                        onChange={(e) => setOnlyNotDoneTasks(e.target.checked)}
                        disabled={loading}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="onlyNotDoneTasks" className="text-sm font-medium text-slate-700 cursor-pointer">
                        Only import "not done" tasks (exclude completed/cancelled)
                      </Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="linearTeamId" className="text-sm font-medium text-slate-700">
                      Linear Team ID
                    </Label>
                    <Input
                      id="linearTeamId"
                      data-testid="input-linear-team-id"
                      placeholder="Linear team ID"
                      value={linearTeamId}
                      onChange={(e) => setLinearTeamId(e.target.value)}
                      disabled={loading}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="linearApiKey" className="text-sm font-medium text-slate-700">
                      Linear API Key
                    </Label>
                    <Input
                      id="linearApiKey"
                      data-testid="input-linear-api-key"
                      type="password"
                      placeholder="Your Linear API key"
                      value={linearApiKey}
                      onChange={(e) => setLinearApiKey(e.target.value)}
                      disabled={loading}
                      className="h-11"
                    />
                    <p className="text-xs text-slate-500">
                      Get an API key from <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Linear settings</a>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription data-testid="text-error">{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className="border-green-200 bg-green-50 text-green-900">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription data-testid="text-success">{success}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3">
              <Button
                onClick={handleExport}
                disabled={loading || !apiToken || !organizationId || !projectId}
                className="flex-1 h-11 text-base font-medium"
                data-testid="button-export"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-5 w-5" />
                    Start Export
                  </>
                )}
              </Button>
              {loading && (
                <Button
                  onClick={handleStop}
                  variant="destructive"
                  className="h-11 px-6"
                  data-testid="button-stop"
                >
                  Stop
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {loading && (
          <Card className="shadow-lg border-slate-200/50 bg-white/80 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl flex items-center gap-2 text-slate-900">
                <Activity className="w-5 h-5 text-blue-600 animate-pulse" />
                Export Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 font-medium">Overall Progress</span>
                  <span className="text-slate-900 font-semibold" data-testid="text-progress-percentage">
                    {progressPercentage}%
                  </span>
                </div>
                <Progress value={progressPercentage} className="h-3" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="text-sm text-slate-600 mb-1">Tasks Processed</div>
                  <div className="text-2xl font-bold text-slate-900" data-testid="text-tasks-processed">
                    {progress.tasksProcessed}/{progress.totalTasks}
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="text-sm text-blue-700 mb-1">Comments Fetched</div>
                  <div className="text-2xl font-bold text-blue-900" data-testid="text-comments-fetched">
                    {progress.commentsProcessed}
                  </div>
                </div>
                <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                  <div className="text-sm text-amber-700 mb-1">Active Requests</div>
                  <div className="text-2xl font-bold text-amber-900" data-testid="text-active-requests">
                    {progress.activeRequests}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="text-sm text-green-700 mb-1">Time Elapsed</div>
                  <div className="text-2xl font-bold text-green-900" data-testid="text-elapsed-time">
                    {elapsedTime}s
                  </div>
                </div>
              </div>

              {progress.totalTasks > 0 && progress.tasksProcessed < progress.totalTasks && (
                <div className="text-center">
                  <div className="text-sm text-slate-600">
                    Estimated time remaining: <span className="font-semibold text-slate-900">{estimatedTimeRemaining}s</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {logs.length > 0 && (
          <Card className="shadow-lg border-slate-200/50 bg-white/80 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl text-slate-900">Activity Log</CardTitle>
              <CardDescription>Real-time export progress and status updates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-900 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className={`py-1 ${
                      log.type === 'error'
                        ? 'text-red-400'
                        : log.type === 'warning'
                        ? 'text-yellow-400'
                        : log.type === 'success'
                        ? 'text-green-400'
                        : 'text-slate-300'
                    }`}
                    data-testid={`log-entry-${index}`}
                  >
                    <span className="text-slate-500">[{log.timestamp}]</span>{' '}
                    {log.message}
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
