import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Export Job Types
export type ExportJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type LogType = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  timestamp: string;
  message: string;
  type: LogType;
}

export interface ProgressStats {
  tasksProcessed: number;
  totalTasks: number;
  commentsProcessed: number;
  activeRequests: number;
  startTime: number;
}

export interface ExportJob {
  id: string;
  status: ExportJobStatus;
  apiToken: string;
  organizationId: string;
  projectId: string;
  logs: LogEntry[];
  progress: ProgressStats;
  csvData?: string;
  error?: string;
  createdAt: number;
}

export const createExportJobSchema = z.object({
  apiToken: z.string().min(1, 'API token is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

export type CreateExportJob = z.infer<typeof createExportJobSchema>;
