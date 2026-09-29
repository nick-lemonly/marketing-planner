/* The planner's data model and every edit the MCP tools can make to it.
   Mirrors what the web app stores in Firestore (planners/main):
     categories:    [{id, name, color, locked?}]     -- order = sidebar order; Uncategorized is locked and last
     items:         [{id, title, categoryId, start, end, notes}]  -- start/end 'YYYY-MM-DD', or null when unscheduled
     blackoutDates: [{id, start, end, label}]
   Everything here is pure: functions take the data object, change it, and return a
   summary, or throw a PlannerError whose message is meant for Claude to read. */

export const UNCATEGORIZED_ID = 'uncategorized';
const PALETTE = ['#F06445', '#41A2A2', '#F5B02B', '#F6D72C', '#1E8583', '#B9481F', '#B9821E', '#6B6B6B', '#3A3A3A'];

export class PlannerError extends Error {}

export function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* Keeps only the planner fields and fills in anything missing, the same way the app does. */
export function normalizeData(d) {
  d = d || {};
  const out = {
    categories: Array.isArray(d.categories) ? d.categories : [],
    items: Array.isArray(d.items) ? d.items : [],
    blackoutDates: (Array.isArray(d.blackoutDates) ? d.blackoutDates : []).map((b) =>
      typeof b === 'string' ? { id: uid('bo'), start: b, end: b, label: '' } : b
    ),
  };
  if (!out.categories.some((c) => c.id === UNCATEGORIZED_ID)) {
    out.categories.push({ id: UNCATEGORIZED_ID, name: 'Uncategorized', color: '#9B9B9B', locked: true });
  }
  return out;
}

/* ================= Validation ================= */
export function checkDate(value, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new PlannerError(`${field} must be a real date in YYYY-MM-DD format (got "${value}").`);
  }
  return value;
}

function checkRange(start, end, label) {
  if (end < start) throw new PlannerError(`${label}: end (${end}) is before start (${start}).`);
}

export function normalizeHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new PlannerError(`Color must be a hex value like #F06445 (got "${hex}").`);
  return '#' + h.toLowerCase();
}

function addDaysISO(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/* ================= Lookups ================= */
/* Accepts a category id or its name (case-insensitive). */
export function resolveCategory(data, ref) {
  const want = String(ref || '').trim();
  const cat =
    data.categories.find((c) => c.id === want) ||
    data.categories.find((c) => c.name.trim().toLowerCase() === want.toLowerCase());
  if (!cat) {
    throw new PlannerError(
      `No category "${ref}". Available: ${data.categories.map((c) => `${c.name} (${c.id})`).join(', ')}.`
    );
  }
  return cat;
}

function findItem(data, id) {
  const it = data.items.find((i) => i.id === id);
  if (!it) throw new PlannerError(`No item with id "${id}". Use list_items to look up ids.`);
  return it;
}

function findBlackout(data, id) {
  const b = data.blackoutDates.find((x) => x.id === id);
  if (!b) throw new PlannerError(`No blackout date with id "${id}". Use list_blackout_dates to look up ids.`);
  return b;
}

/* ================= Presentation ================= */
export function describeItem(data, it) {
  const cat = data.categories.find((c) => c.id === it.categoryId) || data.categories[data.categories.length - 1];
  return {
    id: it.id,
    title: it.title,
    category: cat.name,
    categoryId: cat.id,
    start: it.start || null,
    end: it.start ? it.end || it.start : null,
    notes: it.notes || '',
  };
}

export function overview(data) {
  const counts = {};
  data.items.forEach((it) => {
    counts[it.categoryId] = (counts[it.categoryId] || 0) + 1;
  });
  const scheduled = data.items.filter((it) => it.start);
  const starts = scheduled.map((it) => it.start).sort();
  const ends = scheduled.map((it) => it.end || it.start).sort();
  return {
    categories: data.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      itemCount: counts[c.id] || 0,
      ...(c.locked ? { locked: true } : {}),
    })),
    itemCount: data.items.length,
    scheduledCount: scheduled.length,
    unscheduledCount: data.items.length - scheduled.length,
    scheduledRange: scheduled.length ? { from: starts[0], to: ends[ends.length - 1] } : null,
    blackoutDateCount: data.blackoutDates.length,
  };
}

/* Items overlapping [from, to], optionally filtered; scheduled items sorted by date, unscheduled last. */
export function listItems(data, { from, to, category, search, unscheduled = 'include' } = {}) {
  if (from) checkDate(from, 'from');
  if (to) checkDate(to, 'to');
  const catId = category ? resolveCategory(data, category).id : null;
  const q = (search || '').trim().toLowerCase();
  return data.items
    .filter((it) => {
      if (catId && it.categoryId !== catId) return false;
      if (q && !(it.title + ' ' + (it.notes || '')).toLowerCase().includes(q)) return false;
      if (!it.start) return unscheduled !== 'exclude';
      if (unscheduled === 'only') return false;
      const end = it.end || it.start;
      if (from && end < from) return false;
      if (to && it.start > to) return false;
      return true;
    })
    .sort((a, b) => {
      if (!a.start || !b.start) return (a.start ? 0 : 1) - (b.start ? 0 : 1);
      return a.start.localeCompare(b.start) || (a.end || a.start).localeCompare(b.end || b.start) || a.title.localeCompare(b.title);
    })
    .map((it) => describeItem(data, it));
}

/* ================= Items ================= */
function cleanTitle(title) {
  const t = String(title || '').trim();
  if (!t) throw new PlannerError('Item title cannot be empty.');
  return t;
}

export function createItems(data, specs) {
  return specs.map((spec, i) => {
    const label = `Item ${i + 1} ("${spec.title}")`;
    const cat = spec.category ? resolveCategory(data, spec.category) : resolveCategory(data, UNCATEGORIZED_ID);
    let start = null;
    let end = null;
    if (spec.start) {
      start = checkDate(spec.start, `${label} start`);
      end = spec.end ? checkDate(spec.end, `${label} end`) : start;
      checkRange(start, end, label);
    } else if (spec.end) {
      throw new PlannerError(`${label}: an end date needs a start date (leave both out for an unscheduled item).`);
    }
    const item = { id: uid('it'), title: cleanTitle(spec.title), categoryId: cat.id, start, end, notes: (spec.notes || '').trim() };
    data.items.push(item);
    return describeItem(data, item);
  });
}

/* Moving: giving only a new start keeps the item's length; giving only an end changes its length. */
export function updateItems(data, updates) {
  return updates.map((u) => {
    const it = findItem(data, u.id);
    const label = `Item "${it.title}" (${it.id})`;
    if (u.title !== undefined) it.title = cleanTitle(u.title);
    if (u.category !== undefined) it.categoryId = resolveCategory(data, u.category).id;
    if (u.notes !== undefined) it.notes = String(u.notes).trim();
    if (u.unschedule) {
      if (u.start || u.end) throw new PlannerError(`${label}: use either unschedule or new dates, not both.`);
      it.start = null;
      it.end = null;
    } else if (u.start !== undefined || u.end !== undefined) {
      let start = u.start !== undefined ? checkDate(u.start, `${label} start`) : it.start;
      if (!start) throw new PlannerError(`${label} is unscheduled; give it a start date.`);
      let end;
      if (u.end !== undefined) end = checkDate(u.end, `${label} end`);
      else if (it.start) end = addDaysISO(start, daysBetween(it.start, it.end || it.start));
      else end = start;
      checkRange(start, end, label);
      it.start = start;
      it.end = end;
    }
    delete it.isSample; // same as editing in the app: it's no longer an example item
    return describeItem(data, it);
  });
}

export function deleteItems(data, ids) {
  const removed = ids.map((id) => describeItem(data, findItem(data, id)));
  data.items = data.items.filter((it) => !ids.includes(it.id));
  return removed;
}

/* ================= Categories ================= */
function checkNameFree(data, name, exceptId) {
  const clash = data.categories.find((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) throw new PlannerError(`A category named "${clash.name}" already exists (${clash.id}).`);
}

export function createCategory(data, { name, color }) {
  const n = String(name || '').trim();
  if (!n) throw new PlannerError('Category name cannot be empty.');
  checkNameFree(data, n);
  const used = data.categories.map((c) => c.color.toLowerCase());
  const pick = normalizeHex(color || PALETTE.find((p) => !used.includes(p.toLowerCase())) || PALETTE[data.categories.length % PALETTE.length]);
  const cat = { id: uid('cat'), name: n, color: pick };
  // New categories go just above the locked ones (Uncategorized stays last), like the app's "+ Add".
  const firstLocked = data.categories.findIndex((c) => c.locked);
  data.categories.splice(firstLocked === -1 ? data.categories.length : firstLocked, 0, cat);
  return { ...cat };
}

export function updateCategory(data, { category, name, color }) {
  const cat = resolveCategory(data, category);
  if (cat.locked) throw new PlannerError(`"${cat.name}" is built in and can't be renamed or recolored.`);
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) throw new PlannerError('Category name cannot be empty.');
    checkNameFree(data, n, cat.id);
    cat.name = n;
  }
  if (color !== undefined) cat.color = normalizeHex(color);
  return { id: cat.id, name: cat.name, color: cat.color };
}

export function deleteCategory(data, { category }) {
  const cat = resolveCategory(data, category);
  if (cat.locked) throw new PlannerError(`"${cat.name}" is built in and can't be deleted.`);
  let moved = 0;
  data.items.forEach((it) => {
    if (it.categoryId === cat.id) {
      it.categoryId = UNCATEGORIZED_ID;
      moved++;
    }
  });
  data.categories = data.categories.filter((c) => c.id !== cat.id);
  return { deleted: { id: cat.id, name: cat.name }, itemsMovedToUncategorized: moved };
}

/* order: every movable category, in the new order. Locked ones stay pinned at the end. */
export function reorderCategories(data, order) {
  const movable = data.categories.filter((c) => !c.locked);
  const cats = order.map((ref) => resolveCategory(data, ref));
  const ids = cats.map((c) => c.id);
  if (cats.some((c) => c.locked)) throw new PlannerError('Uncategorized always stays last; leave it out of the order.');
  if (new Set(ids).size !== ids.length) throw new PlannerError('The order lists a category more than once.');
  const missing = movable.filter((c) => !ids.includes(c.id));
  if (missing.length) {
    throw new PlannerError(`The order must include every category. Missing: ${missing.map((c) => c.name).join(', ')}.`);
  }
  data.categories = cats.concat(data.categories.filter((c) => c.locked));
  return data.categories.map((c) => c.name);
}

/* ================= Blackout dates ================= */
export function listBlackouts(data, { year } = {}) {
  return data.blackoutDates
    .filter((b) => !year || (b.start <= `${year}-12-31` && (b.end || b.start) >= `${year}-01-01`))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((b) => ({ id: b.id, start: b.start, end: b.end || b.start, label: b.label || '' }));
}

export function addBlackouts(data, specs) {
  return specs.map((spec, i) => {
    const label = `Blackout ${i + 1}`;
    const start = checkDate(spec.start, `${label} start`);
    const end = spec.end ? checkDate(spec.end, `${label} end`) : start;
    checkRange(start, end, label);
    const b = { id: uid('bo'), start, end, label: (spec.label || '').trim() };
    data.blackoutDates.push(b);
    return { ...b };
  });
}

export function updateBlackout(data, { id, start, end, label }) {
  const b = findBlackout(data, id);
  const s = start !== undefined ? checkDate(start, 'start') : b.start;
  const e = end !== undefined ? checkDate(end, 'end') : start !== undefined && b.end === b.start ? s : b.end || b.start;
  checkRange(s, e, `Blackout ${id}`);
  b.start = s;
  b.end = e;
  if (label !== undefined) b.label = String(label).trim();
  return { id: b.id, start: b.start, end: b.end, label: b.label || '' };
}

export function deleteBlackouts(data, ids) {
  const removed = ids.map((id) => ({ ...findBlackout(data, id) }));
  data.blackoutDates = data.blackoutDates.filter((b) => !ids.includes(b.id));
  return removed;
}

/* ================= Restore ================= */
/* Accepts an MCP backup or a file from the app's "Export JSON" button. */
export function dataFromBackup(json) {
  if (!json || !Array.isArray(json.categories) || !Array.isArray(json.items)) {
    throw new PlannerError('That file is not a planner backup (it needs categories and items arrays).');
  }
  return normalizeData(json);
}
