/* Drives the real MCP server through an in-process client, against an in-memory planner. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPlannerServer } from '../server.js';
import { createBackups, createMemoryStore } from '../store.js';

const SEED = {
  categories: [
    { id: 'cat_blog', name: 'Blog', color: '#f06445' },
    { id: 'cat_paid', name: 'Paid Media', color: '#f5b02b' },
    { id: 'uncategorized', name: 'Uncategorized', color: '#9b9b9b', locked: true },
  ],
  items: [
    { id: 'it_a', title: 'Spring post', categoryId: 'cat_blog', start: '2027-03-02', end: '2027-03-02', notes: '', isSample: true },
    { id: 'it_b', title: 'Search refresh', categoryId: 'cat_paid', start: '2027-03-08', end: '2027-03-12', notes: 'Q1 budget' },
    { id: 'it_c', title: 'Someday idea', categoryId: 'cat_blog', start: null, end: null, notes: '' },
  ],
  blackoutDates: [{ id: 'bo_1', start: '2027-01-01', end: '2027-01-01', label: "New Year's Day" }],
};

let client, store, backupDir;

before(async () => {
  backupDir = await mkdtemp(path.join(os.tmpdir(), 'planner-backups-'));
  store = createMemoryStore(SEED);
  const server = createPlannerServer({ store, backups: createBackups({ dir: backupDir, keep: 5 }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
});

after(async () => {
  await client.close();
  await rm(backupDir, { recursive: true, force: true });
});

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  return res.isError ? { error: text } : JSON.parse(text);
}

test('lists all tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'add_blackout_dates', 'create_category', 'create_items', 'delete_blackout_dates', 'delete_category',
    'delete_items', 'get_planner', 'list_backups', 'list_blackout_dates', 'list_items', 'reorder_categories',
    'restore_backup', 'update_blackout_date', 'update_category', 'update_items',
  ]);
});

test('get_planner summarizes categories and counts', async () => {
  const r = await call('get_planner');
  assert.match(r.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.itemCount, 3);
  assert.equal(r.unscheduledCount, 1);
  assert.deepEqual(r.scheduledRange, { from: '2027-03-02', to: '2027-03-12' });
  assert.deepEqual(r.categories.map((c) => [c.name, c.itemCount]), [['Blog', 2], ['Paid Media', 1], ['Uncategorized', 0]]);
});

test('list_items filters by range, category name, search, and unscheduled', async () => {
  assert.deepEqual((await call('list_items', { from: '2027-03-10', to: '2027-03-31', unscheduled: 'exclude' })).items.map((i) => i.id), ['it_b']);
  assert.deepEqual((await call('list_items', { category: 'blog' })).items.map((i) => i.id), ['it_a', 'it_c']);
  assert.deepEqual((await call('list_items', { search: 'budget' })).items.map((i) => i.id), ['it_b']);
  assert.deepEqual((await call('list_items', { unscheduled: 'only' })).items.map((i) => i.id), ['it_c']);
  assert.match((await call('list_items', { category: 'Nope' })).error, /No category "Nope". Available: Blog/);
});

test('create_items adds scheduled and unscheduled items, and validates', async () => {
  const r = await call('create_items', {
    items: [
      { title: 'Launch post', category: 'Blog', start: '2027-04-06' },
      { title: 'Idea', category: 'paid media' },
    ],
  });
  assert.equal(r.created.length, 2);
  assert.deepEqual([r.created[0].start, r.created[0].end, r.created[0].category], ['2027-04-06', '2027-04-06', 'Blog']);
  assert.equal(r.created[1].start, null);
  assert.match(r.backup, /_create_items\.json$/);

  assert.match((await call('create_items', { items: [{ title: 'x', start: '2027-02-30' }] })).error, /real date/);
  assert.match((await call('create_items', { items: [{ title: 'x', start: '2027-05-05', end: '2027-05-01' }] })).error, /before start/);
  // A failed batch changes nothing.
  assert.equal(store.snapshot().items.length, 5);
});

test('update_items moves (keeping length), resizes, recategorizes, and unschedules', async () => {
  const moved = await call('update_items', { updates: [{ id: 'it_b', start: '2027-03-22' }] });
  assert.deepEqual([moved.updated[0].start, moved.updated[0].end], ['2027-03-22', '2027-03-26']);

  const resized = await call('update_items', { updates: [{ id: 'it_b', end: '2027-03-30' }] });
  assert.equal(resized.updated[0].end, '2027-03-30');

  const r = await call('update_items', {
    updates: [
      { id: 'it_a', category: 'Paid Media', title: 'Spring post (paid)' },
      { id: 'it_c', start: '2027-06-01' },
    ],
  });
  assert.equal(r.updated[0].category, 'Paid Media');
  assert.deepEqual([r.updated[1].start, r.updated[1].end], ['2027-06-01', '2027-06-01']);
  assert.equal(store.snapshot().items.find((i) => i.id === 'it_a').isSample, undefined);

  const un = await call('update_items', { updates: [{ id: 'it_c', unschedule: true }] });
  assert.equal(un.updated[0].start, null);
  assert.match((await call('update_items', { updates: [{ id: 'missing' }] })).error, /No item with id "missing"/);
});

test('categories: create, rename, recolor, reorder, delete', async () => {
  const c = await call('create_category', { name: 'Events' });
  assert.match(c.created.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(store.snapshot().categories.map((x) => x.name), ['Blog', 'Paid Media', 'Events', 'Uncategorized']);
  assert.match((await call('create_category', { name: 'events' })).error, /already exists/);

  await call('update_category', { category: 'Events', name: 'Live Events', color: '#3a3' });
  assert.equal(store.snapshot().categories.find((x) => x.name === 'Live Events').color, '#33aa33');
  assert.match((await call('update_category', { category: 'Uncategorized', name: 'x' })).error, /built in/);

  const o = await call('reorder_categories', { order: ['Live Events', 'Paid Media', 'Blog'] });
  assert.deepEqual(o.order, ['Live Events', 'Paid Media', 'Blog', 'Uncategorized']);
  assert.match((await call('reorder_categories', { order: ['Blog'] })).error, /Missing: /);

  await call('create_items', { items: [{ title: 'Meetup', category: 'Live Events', start: '2027-07-01' }] });
  const d = await call('delete_category', { category: 'Live Events' });
  assert.equal(d.itemsMovedToUncategorized, 1);
  assert.equal(store.snapshot().items.find((i) => i.title === 'Meetup').categoryId, 'uncategorized');
});

test('blackout dates: add, list by year, update, delete', async () => {
  const a = await call('add_blackout_dates', { dates: [{ start: '2027-12-24', end: '2027-12-26', label: 'Holiday' }, { start: '2028-01-01' }] });
  assert.equal(a.added.length, 2);
  assert.deepEqual((await call('list_blackout_dates', { year: 2027 })).map((b) => b.label), ["New Year's Day", 'Holiday']);
  const u = await call('update_blackout_date', { id: a.added[1].id, start: '2028-01-02' });
  assert.deepEqual([u.updated.start, u.updated.end], ['2028-01-02', '2028-01-02']);
  await call('delete_blackout_dates', { ids: ['bo_1'] });
  assert.equal(store.snapshot().blackoutDates.length, 2);
});

test('delete_items, backups, and restore', async () => {
  const before = store.snapshot();
  const del = await call('delete_items', { ids: ['it_b'] });
  assert.equal(del.deleted[0].title, 'Search refresh');
  assert.equal(store.snapshot().items.some((i) => i.id === 'it_b'), false);

  // Restoring the backup taken just before the delete brings the item back.
  const restored = await call('restore_backup', { backup: del.backup });
  assert.equal(restored.itemCount, before.items.length);
  assert.equal(store.snapshot().items.some((i) => i.id === 'it_b'), true);

  // Backups are pruned to `keep` (5), newest first.
  const list = await call('list_backups');
  assert.equal(list.backups.length, 5);
  assert.match(list.backups[0], /_restore_backup\.json$/);

  // A file from the app's Export JSON button restores too.
  const exported = path.join(backupDir, 'export.json');
  await writeFile(exported, JSON.stringify({ app: 'lemonly-marketing-planner', exportedAt: 'now', ...SEED }));
  assert.equal((await call('restore_backup', { backup: exported })).itemCount, 3);
  assert.match((await call('restore_backup', { backup: '/nope/missing.json' })).error, /No backup file/);
});
