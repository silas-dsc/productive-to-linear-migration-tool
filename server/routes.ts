import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { createExportJobSchema } from "@shared/schema";
import type { ExportJob } from "@shared/schema";
import { createJob, getJob, updateJob } from "./job-storage";
import { processExportJob } from "./export-worker";
import { randomBytes } from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  // POST /api/export - Create a new export job
  app.post('/api/export', async (req, res) => {
    try {
      const validatedData = createExportJobSchema.parse(req.body);
      
      const jobId = randomBytes(16).toString('hex');
      const job: ExportJob = {
        id: jobId,
        status: 'pending',
        apiToken: validatedData.apiToken,
        organizationId: validatedData.organizationId,
        projectId: validatedData.projectId,
        logs: [],
        progress: {
          tasksProcessed: 0,
          totalTasks: 0,
          commentsProcessed: 0,
          activeRequests: 0,
          startTime: 0,
        },
        createdAt: Date.now(),
      };

      createJob(job);

      // Start processing in background
      processExportJob(job, (updates) => {
        updateJob(jobId, updates);
      }).catch(err => {
        console.error(`Job ${jobId} failed:`, err);
        updateJob(jobId, { status: 'failed', error: err.message });
      });

      res.json({ jobId });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid request' });
    }
  });

  // GET /api/export/:jobId/stream - SSE endpoint for real-time progress
  app.get('/api/export/:jobId/stream', (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial state
    res.write(`data: ${JSON.stringify({ 
      type: 'init',
      job: {
        id: job.id,
        status: job.status,
        logs: job.logs,
        progress: job.progress,
        error: job.error,
      }
    })}\n\n`);

    // Poll for updates
    const interval = setInterval(() => {
      const currentJob = getJob(jobId);
      if (!currentJob) {
        clearInterval(interval);
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({
        type: 'update',
        job: {
          id: currentJob.id,
          status: currentJob.status,
          logs: currentJob.logs,
          progress: currentJob.progress,
          error: currentJob.error,
        }
      })}\n\n`);

      // End stream when job is complete or failed
      if (currentJob.status === 'completed' || currentJob.status === 'failed') {
        clearInterval(interval);
        setTimeout(() => res.end(), 1000);
      }
    }, 500); // Send updates every 500ms

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  });

  // GET /api/export/:jobId/status - Polling endpoint as fallback
  app.get('/api/export/:jobId/status', (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      logs: job.logs,
      progress: job.progress,
      error: job.error,
    });
  });

  // GET /api/export/:jobId/download - Download the CSV file
  app.get('/api/export/:jobId/download', (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (job.status !== 'completed' || !job.csvData) {
      res.status(400).json({ error: 'Export not ready yet' });
      return;
    }

    const filename = `productive_tasks_project_${job.projectId}_${new Date().toISOString().split('T')[0]}.csv`;
    
    res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(job.csvData);
  });

  const httpServer = createServer(app);

  return httpServer;
}
