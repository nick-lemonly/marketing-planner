/* MCP tool definitions for the Lemonly Marketing Planner. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as P from './planner-data.js';

const INSTRUCTIONS = `Tools for the Lemonly Marketing Planner, a shared marketing calendar (Monthly Calendar + Timeline views) that the Lemonly team views in a web app.
- Dates are always YYYY-MM-DD. An item with no start date is "unscheduled" and sits in the app's Unscheduled list.
- Categories can be referred to by id or by name. Every item has exactly one category; "Uncategorized" is built in.
- Blackout dates gray out days (holidays, office closures) on the calendar; they are separate from items.
- Every change saves a backup of the whole planner first; use list_backups / restore_backup to undo.
- Call get_planner first to see the categories and today's date. Batch related changes into one call where the tool allows it.`;

const DATE = z.string().describe('Date as YYYY-MM-DD');
const CATEGORY_REF = z.string().describe('Category id or name (case-insensitive)');

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function reply(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/* PlannerErrors are Claude's to fix (bad id, bad date); anything else is a real failure. */
function tool(handler) {
  return async (args) => {
    try {
      return reply(await handler(args ?? {}));
    } catch (err) {
      const message = err instanceof P.PlannerError ? err.message : `Unexpected error: ${err.message}`;
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  };
}

export function createPlannerServer({ store, backups }) {
  const server = new McpServer({ name: 'lemonly-planner', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  /* Applies fn to the planner in one transaction, backing up the current state first. */
  async function change(reason, fn) {
    const stamp = new Date().toISOString();
    let backup;
    const result = await store.update(async (data, before) => {
      backup = await backups.save(before, reason, stamp);
      return fn(data);
    });
    return { ...result, backup };
  }

  const read = async () => (await store.read()).data;
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const edits = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const deletes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

  /* ================= Reading ================= */
  server.registerTool(
    'get_planner',
    {
      title: 'Planner overview',
      description: "Today's date, every category (id, name, color, item count, in display order), and item and blackout-date totals. Start here.",
      annotations: readOnly,
    },
    tool(async () => {
      const { data, updatedAt, updatedBy } = await store.read();
      return { today: localToday(), lastUpdated: updatedAt, lastUpdatedBy: updatedBy, ...P.overview(data) };
    })
  );

  server.registerTool(
    'list_items',
    {
      title: 'List items',
      description: 'Items on the planner, sorted by date (unscheduled items last). Filters combine: from/to returns scheduled items overlapping that range.',
      inputSchema: {
        from: DATE.optional(),
        to: DATE.optional(),
        category: CATEGORY_REF.optional(),
        search: z.string().optional().describe('Case-insensitive text to find in titles or notes'),
        unscheduled: z.enum(['include', 'exclude', 'only']).optional().describe('Default: include'),
      },
      annotations: readOnly,
    },
    tool(async (args) => {
      const items = P.listItems(await read(), args);
      return { count: items.length, items };
    })
  );

  server.registerTool(
    'list_blackout_dates',
    {
      title: 'List blackout dates',
      description: 'Blackout dates (grayed-out days such as holidays), optionally only those touching a given year.',
      inputSchema: { year: z.number().int().optional() },
      annotations: readOnly,
    },
    tool(async ({ year }) => P.listBlackouts(await read(), { year }))
  );

  /* ================= Items ================= */
  server.registerTool(
    'create_items',
    {
      title: 'Create items',
      description: 'Add one or more items. Leave out start and end to add an item as unscheduled. end defaults to start (a one-day item).',
      inputSchema: {
        items: z
          .array(
            z.object({
              title: z.string().max(120),
              category: CATEGORY_REF.optional().describe('Category id or name; default Uncategorized'),
              start: DATE.optional(),
              end: DATE.optional(),
              notes: z.string().max(600).optional(),
            })
          )
          .min(1),
      },
      annotations: edits,
    },
    tool(async ({ items }) => change('create_items', (data) => ({ created: P.createItems(data, items) })))
  );

  server.registerTool(
    'update_items',
    {
      title: 'Update items',
      description:
        'Edit one or more items by id. Only the fields you pass change. To move an item, pass just a new start and its length is kept; pass end too (or only end) to change its length. unschedule: true moves it to the Unscheduled list.',
      inputSchema: {
        updates: z
          .array(
            z.object({
              id: z.string(),
              title: z.string().max(120).optional(),
              category: CATEGORY_REF.optional(),
              start: DATE.optional(),
              end: DATE.optional(),
              notes: z.string().max(600).optional(),
              unschedule: z.boolean().optional(),
            })
          )
          .min(1),
      },
      annotations: edits,
    },
    tool(async ({ updates }) => change('update_items', (data) => ({ updated: P.updateItems(data, updates) })))
  );

  server.registerTool(
    'delete_items',
    {
      title: 'Delete items',
      description: 'Permanently remove items by id. (A backup is saved first.)',
      inputSchema: { ids: z.array(z.string()).min(1) },
      annotations: deletes,
    },
    tool(async ({ ids }) => change('delete_items', (data) => ({ deleted: P.deleteItems(data, ids) })))
  );

  /* ================= Categories ================= */
  server.registerTool(
    'create_category',
    {
      title: 'Create category',
      description: 'Add a category. It goes at the end of the list (above Uncategorized). A color is picked automatically if none is given.',
      inputSchema: { name: z.string().max(40), color: z.string().optional().describe('Hex color like #F06445') },
      annotations: edits,
    },
    tool(async (args) => change('create_category', (data) => ({ created: P.createCategory(data, args) })))
  );

  server.registerTool(
    'update_category',
    {
      title: 'Update category',
      description: 'Rename or recolor a category.',
      inputSchema: {
        category: CATEGORY_REF,
        name: z.string().max(40).optional(),
        color: z.string().optional().describe('Hex color like #F06445'),
      },
      annotations: edits,
    },
    tool(async (args) => change('update_category', (data) => ({ updated: P.updateCategory(data, args) })))
  );

  server.registerTool(
    'delete_category',
    {
      title: 'Delete category',
      description: "Remove a category. Its items aren't deleted; they move to Uncategorized.",
      inputSchema: { category: CATEGORY_REF },
      annotations: deletes,
    },
    tool(async (args) => change('delete_category', (data) => P.deleteCategory(data, args)))
  );

  server.registerTool(
    'reorder_categories',
    {
      title: 'Reorder categories',
      description: 'Set the display order of categories (sidebar and Timeline rows). List every category except Uncategorized, which always stays last.',
      inputSchema: { order: z.array(CATEGORY_REF).min(1) },
      annotations: edits,
    },
    tool(async ({ order }) => change('reorder_categories', (data) => ({ order: P.reorderCategories(data, order) })))
  );

  /* ================= Blackout dates ================= */
  server.registerTool(
    'add_blackout_dates',
    {
      title: 'Add blackout dates',
      description: 'Add one or more blackout dates or ranges. end defaults to start.',
      inputSchema: {
        dates: z.array(z.object({ start: DATE, end: DATE.optional(), label: z.string().max(120).optional() })).min(1),
      },
      annotations: edits,
    },
    tool(async ({ dates }) => change('add_blackout_dates', (data) => ({ added: P.addBlackouts(data, dates) })))
  );

  server.registerTool(
    'update_blackout_date',
    {
      title: 'Update blackout date',
      description: 'Change a blackout date’s dates or label by id.',
      inputSchema: { id: z.string(), start: DATE.optional(), end: DATE.optional(), label: z.string().max(120).optional() },
      annotations: edits,
    },
    tool(async (args) => change('update_blackout_date', (data) => ({ updated: P.updateBlackout(data, args) })))
  );

  server.registerTool(
    'delete_blackout_dates',
    {
      title: 'Delete blackout dates',
      description: 'Remove blackout dates by id.',
      inputSchema: { ids: z.array(z.string()).min(1) },
      annotations: deletes,
    },
    tool(async ({ ids }) => change('delete_blackout_dates', (data) => ({ deleted: P.deleteBlackouts(data, ids) })))
  );

  /* ================= Backups ================= */
  server.registerTool(
    'list_backups',
    {
      title: 'List backups',
      description: 'Backups saved before each change, newest first. Names start with the time (UTC) and end with the tool that made the change.',
      annotations: readOnly,
    },
    tool(async () => ({ folder: backups.dir, backups: await backups.list() }))
  );

  server.registerTool(
    'restore_backup',
    {
      title: 'Restore backup',
      description:
        "Replace the whole planner with a backup: a name from list_backups, or an absolute path to a file from the app's Export JSON button. The current state is backed up first, so a restore can itself be undone.",
      inputSchema: { backup: z.string().describe('Backup name or absolute file path') },
      annotations: deletes,
    },
    tool(async ({ backup }) => {
      const restored = P.dataFromBackup(await backups.load(backup));
      return change('restore_backup', (data) => {
        data.categories = restored.categories;
        data.items = restored.items;
        data.blackoutDates = restored.blackoutDates;
        return { restoredFrom: backup, ...P.overview(data) };
      });
    })
  );

  return server;
}
