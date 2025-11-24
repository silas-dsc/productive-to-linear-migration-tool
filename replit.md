# Productive Task Exporter

## Overview

This is a high-performance web application designed to export tasks and comments from Productive.io projects to CSV format. The application uses server-side processing with a 120-second error cooldown policy to ensure reliable data fetching from the Productive.io API. Built with React on the frontend and Express on the backend, it provides real-time progress tracking via Server-Sent Events (SSE) and comprehensive logging during the export process.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18 with TypeScript for type safety and modern component patterns
- Vite as the build tool for fast development and optimized production builds
- Wouter for lightweight client-side routing
- Single-page application (SPA) architecture with all processing happening client-side

**UI Component System**
- shadcn/ui component library following Material Design principles with "new-york" style variant
- Radix UI primitives for accessible, unstyled component foundations
- Tailwind CSS for utility-first styling with custom design tokens
- Component organization under `client/src/components/ui/` with path aliases (`@/components`)

**State Management & Data Fetching**
- Local React state (useState) for form inputs and UI state
- Server-Sent Events (EventSource) for real-time progress updates from backend
- All Productive.io API calls handled server-side
- No client-side data fetching or CSV generation

**Key Design Decisions**
- Server-side processing enables long-running tasks without browser timeouts
- EventSource/SSE provides real-time progress streaming without polling overhead
- 120-second global cooldown on any API error ensures reliable operation
- Password inputs for API tokens to maintain security (credentials never stored)

### Backend Architecture

**Server Framework**
- Express.js with TypeScript for type-safe server code
- Development mode using tsx with Vite middleware for hot module replacement
- Production mode serving pre-built static assets from `dist/public`
- Server-Sent Events (SSE) for real-time progress streaming

**Application Structure**
- Export job orchestration via `server/export-worker.ts`
- Productive.io API client with 120-second error cooldown in `server/export-worker.ts`
- In-memory job storage via `server/job-storage.ts` (no database required)
- RESTful API routes in `server/routes.ts`:
  - POST /api/export - Start export job, returns jobId
  - GET /api/export/:jobId/stream - SSE endpoint for real-time updates
  - GET /api/export/:jobId/status - Polling fallback endpoint
  - GET /api/export/:jobId/download - Download completed CSV
- Separate entry points for development (`index-dev.ts`) and production (`index-prod.ts`)

**Key Design Decisions**
- Server-side API orchestration eliminates CORS issues and browser timeout constraints
- Global 120-second cooldown on ANY Productive.io API error (replaces exponential backoff)
- SSE provides efficient real-time updates without polling
- Job cleanup runs every 10 minutes to remove jobs older than 1 hour
- Parallel comment fetching (5 concurrent requests) with 300ms delays between batches
- CSV generation happens server-side and is cached until download

### Data Storage Solutions

**Current State**
- In-memory job storage for active export jobs (auto-cleanup after 1 hour)
- No persistent database required or used
- User schema defined with Drizzle ORM but not implemented in application logic

**Database Configuration**
- Drizzle ORM configured for PostgreSQL with Neon Database serverless driver
- Schema defined in `shared/schema.ts` with user table and export job types
- Migration system configured to output to `./migrations` directory
- Database credentials expected via `DATABASE_URL` environment variable

**Key Design Decisions**
- In-memory job storage sufficient for transient export tasks
- Database infrastructure prepared for future authentication/user management features
- Drizzle chosen for type-safe database operations and automatic schema migrations

### External Dependencies

**Third-Party APIs**
- Productive.io REST API for fetching tasks, comments, and project data
- Direct server-to-API communication (no CORS proxy needed)
- 120-second global cooldown on ANY API error
- 5 retries with exponential backoff (1s→2s→4s→8s→10s) before triggering cooldown
- Special rate limit handling (429 errors) with aggressive backoff (5s→10s→20s→30s)

**UI & Component Libraries**
- shadcn/ui (complete component collection installed)
- Radix UI primitives for 20+ component types (accordion, dialog, dropdown, etc.)
- Lucide React for icon set (Download, FileText, Loader2, CheckCircle2, AlertCircle, Zap, Activity)
- class-variance-authority for type-safe component variant management

**Development Tools**
- Replit-specific plugins for runtime error overlay, cartographer, and dev banner
- esbuild for production server bundling
- PostCSS with Tailwind CSS and autoprefixer for style processing

**Authentication & Sessions**
- connect-pg-simple for PostgreSQL session store (configured but not actively used)
- No active authentication system implemented
- API tokens managed client-side via form inputs

**Key Design Decisions**
- Server-side API calls eliminate CORS issues entirely
- Heavy reliance on Radix UI ensures accessibility compliance out of the box
- Comprehensive shadcn/ui installation provides design consistency across all components
- Development tooling optimized for Replit environment

## Recent Changes (November 24, 2025)

**Major Architectural Overhaul: Client-Side → Server-Side Processing**

- Moved all Productive.io API calls from client to backend Express server
- Implemented 120-second global error cooldown (replaces exponential backoff strategy)
- Added Server-Sent Events (SSE) for real-time progress streaming to frontend
- Created export job orchestration system with in-memory storage
- Backend modules:
  - `server/export-worker.ts` - Productive API client with cooldown logic and CSV generation
  - `server/job-storage.ts` - In-memory job storage with auto-cleanup
  - `server/routes.ts` - RESTful API endpoints for job management
- Frontend simplified to use EventSource for SSE connection
- Removed CORS proxy dependency (corsproxy.io)
- Benefits: No browser timeouts, centralized error handling, better reliability