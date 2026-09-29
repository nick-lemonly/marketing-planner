#!/usr/bin/env node
/* Local MCP server for the Lemonly Marketing Planner, run by Claude Desktop / Claude Code over stdio.
   Environment:
     GOOGLE_APPLICATION_CREDENTIALS  path to the Firebase service account key (keep it outside the repo)
     PLANNER_PROJECT_ID              Firebase project id (default: lemonly-marketing-planner)
     PLANNER_BACKUP_DIR              where backups go (default: mcp/backups, which is gitignored) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlannerServer } from './server.js';
import { createBackups, createFirestoreStore } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Google's client libraries can reject a stray promise after a failed call (e.g. bad
// credentials). Log it rather than letting it take down the server mid-conversation.
// stdout carries the MCP protocol, so diagnostics go to stderr.
process.on('unhandledRejection', (err) => {
  console.error('[lemonly-planner] unhandled error:', err?.message || err);
});

const server = createPlannerServer({
  store: createFirestoreStore({ projectId: process.env.PLANNER_PROJECT_ID || 'lemonly-marketing-planner' }),
  backups: createBackups({ dir: process.env.PLANNER_BACKUP_DIR || path.join(here, 'backups') }),
});

await server.connect(new StdioServerTransport());
