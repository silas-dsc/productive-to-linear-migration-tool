import type { ExportJob } from '@shared/schema';

// In-memory job storage
const jobs = new Map<string, ExportJob>();

export function createJob(job: ExportJob): void {
  jobs.set(job.id, job);
}

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<ExportJob>): void {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
    jobs.set(id, job);
  }
}

export function deleteJob(id: string): void {
  jobs.delete(id);
}

export function getAllJobs(): ExportJob[] {
  return Array.from(jobs.values());
}

// Clean up old jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  const entries = Array.from(jobs.entries());
  for (const [id, job] of entries) {
    if (job.createdAt < oneHourAgo) {
      jobs.delete(id);
    }
  }
}, 600000); // Run every 10 minutes
