# Productive to Linear Migration Tool

## Overview
This tool exports tasks from Productive and imports them into Linear, preserving comments, attachments, and metadata. It supports filtering, CSV export, and robust error handling for long-running jobs.

## Prerequisites
- Node.js (v18+ recommended)
- pnpm (or npm)

## Installation
```bash
pnpm install
# or
npm install
```

## Running Locally
```bash
pnpm run dev
# or
npm run dev
```

## Building for Production
```bash
pnpm run build
# or
npm run build
```

## Other scripts
See the "scripts" section of `package.json` for other tests that can be run.

## Configuration
Create a `.env` file in the root directory, use .env.example as a guide. You will need to copy this to `client/.env`. Don't commit these files as they will contain your private API keys (see later for how to generate these)

```
# Productive API
PRODUCTIVE_API_TOKEN=your_productive_api_token
PRODUCTIVE_ORGANIZATION_ID=your_organization_id
PRODUCTIVE_PROJECT_ID=your_project_id

# Linear API (optional, for import)
LINEAR_API_KEY=your_linear_api_key
LINEAR_TEAM_ID=your_linear_team_id
```

You can also enter these values in the web UI when starting an export job.

## How to Get API Keys and IDs

### Productive
1. **API Token**: Log in to Productive, go to your profile > API Tokens, and generate a new token.
2. **Organization ID**: Found in your Productive workspace URL (e.g., `https://app.productive.io/{organization_id}/...`).
3. **Project ID**: Go to the project in Productive, and copy the ID from the URL (e.g., `https://app.productive.io/{organization_id}/projects/{project_id}`).

### Linear
1. **API Key**: Log in to Linear, go to Settings > API > Personal API Keys, and generate a new key.
2. **Team ID**: Go to your team in Linear, and copy the ID from the URL (e.g., `https://linear.app/team/{team_id}/...`).

## Usage
1. Start the app with `pnpm run dev`.
2. Open the web UI in your browser (default: http://localhost:5001).
3. Enter your Productive and Linear credentials, select options, and start the export.
4. Download the CSV or view logs for troubleshooting.

## Troubleshooting
- If you see network errors, double-check your API keys and IDs.
- Logs will show detailed debug info for API responses.
- For rate limits, the tool will automatically wait and retry.

## Advanced
- To change the port, set `PORT=xxxx` in your `.env.local`.
- For custom builds, see `package.json` scripts.

## License
MIT
