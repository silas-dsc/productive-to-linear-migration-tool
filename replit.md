# Productive Task Exporter

## Overview

This is a high-performance web application designed to export tasks and comments from Productive.io projects to CSV format. The application uses optimized parallel processing to achieve 3-5x faster performance compared to traditional sequential approaches. Built with React on the frontend and Express on the backend, it provides real-time progress tracking and comprehensive logging during the export process.

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
- TanStack React Query for server state management and caching
- Local React state (useState) for form inputs and UI state
- Real-time progress tracking with in-memory state updates
- No backend database integration - all API calls are made directly from the client to Productive.io

**Key Design Decisions**
- Client-side CSV generation to reduce server load and enable offline processing
- Parallel request batching for high-performance data fetching
- Real-time log streaming with auto-scroll behavior for user feedback
- Password inputs for API tokens to maintain security

### Backend Architecture

**Server Framework**
- Express.js with TypeScript for type-safe server code
- Development mode using tsx with Vite middleware for hot module replacement
- Production mode serving pre-built static assets from `dist/public`
- HTTP-only server (no WebSocket connections)

**Application Structure**
- Minimal backend footprint - primarily serves as a static file host
- Routes defined in `server/routes.ts` (currently minimal, prefixed with `/api`)
- In-memory storage interface (`MemStorage`) for potential future user management
- Separate entry points for development (`index-dev.ts`) and production (`index-prod.ts`)

**Key Design Decisions**
- Backend serves mainly as infrastructure for frontend delivery
- All Productive.io API interactions happen client-side via CORS proxy
- Raw body parsing enabled for potential webhook integrations
- Request/response logging with timing information for debugging

### Data Storage Solutions

**Current State**
- No persistent database in active use
- In-memory storage interface defined but not actively utilized
- User schema defined with Drizzle ORM but not implemented in application logic

**Database Configuration**
- Drizzle ORM configured for PostgreSQL with Neon Database serverless driver
- Schema defined in `shared/schema.ts` with user table structure
- Migration system configured to output to `./migrations` directory
- Database credentials expected via `DATABASE_URL` environment variable

**Key Design Decisions**
- Application currently operates without persistent storage
- Database infrastructure prepared for future authentication/user management features
- Drizzle chosen for type-safe database operations and automatic schema migrations

### External Dependencies

**Third-Party APIs**
- Productive.io REST API for fetching tasks, comments, and project data
- CORS proxy (corsproxy.io) used to bypass browser CORS restrictions when accessing Productive.io API
- Retry logic with exponential backoff for handling API rate limits and transient failures

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
- CORS proxy enables direct client-to-API communication without backend proxying
- Heavy reliance on Radix UI ensures accessibility compliance out of the box
- Comprehensive shadcn/ui installation provides design consistency across all components
- Development tooling optimized for Replit environment