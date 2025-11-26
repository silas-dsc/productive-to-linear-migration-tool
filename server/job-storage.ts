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

export function stopJob(id: string): void {
  const job = jobs.get(id);
  if (job) {
    (job as any).shouldStop = true;
    jobs.set(id, job);
  }
}

// Clean up old jobs (older than 24 hours) or stopped jobs
setInterval(() => {
  const twentyFourHoursAgo = Date.now() - 86400000; // 24 hours in milliseconds
  const entries = Array.from(jobs.entries());
  for (const [id, job] of entries) {
    if (job.createdAt < twentyFourHoursAgo || (job as any).shouldStop) {
      jobs.delete(id);
    }
  }
}, 600000); // Run every 10 minutes
