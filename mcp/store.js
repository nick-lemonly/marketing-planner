/* Where the planner lives (Firestore) and where backups go (local JSON files). */
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { normalizeData, PlannerError } from './planner-data.js';

const PLANNER_DOC = 'planners/main';
const UPDATED_BY = 'claude-mcp';

function pick(d) {
  return { categories: d.categories, items: d.items, blackoutDates: d.blackoutDates };
}

/* Reads use the service account from GOOGLE_APPLICATION_CREDENTIALS. That account
   bypasses firestore.rules, so the key file must stay private and out of the repo. */
export function createFirestoreStore({ projectId }) {
  let ref = null;

  /* Connects on first use, after checking the key file, so a missing key shows up as a
     clear tool error instead of a crash when Claude starts the server. */
  async function doc() {
    if (ref) return ref;
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyPath) {
      throw new PlannerError('GOOGLE_APPLICATION_CREDENTIALS isn\'t set. Point it at the Firebase service account key file in the MCP server config.');
    }
    try {
      await access(keyPath);
    } catch {
      throw new PlannerError(`The service account key file wasn't found at ${keyPath}. Check the path in the MCP server config.`);
    }
    const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
    db.settings({ ignoreUndefinedProperties: true });
    ref = db.doc(PLANNER_DOC);
    return ref;
  }

  return {
    async read() {
      const snap = await (await doc()).get();
      if (!snap.exists) throw missingDoc();
      const d = snap.data();
      return { data: normalizeData(pick(d)), updatedAt: d.updatedAt?.toDate?.().toISOString() ?? null, updatedBy: d.updatedBy ?? null };
    },

    /* Runs fn(data, before) inside a transaction, so an edit made in the app between
       our read and write makes Firestore retry with fresh data instead of losing it.
       fn may run more than once; it must only change `data`. */
    async update(fn) {
      const ref = await doc();
      return ref.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw missingDoc();
        const before = normalizeData(pick(snap.data()));
        const data = structuredClone(before);
        const result = await fn(data, before);
        // Same shape the app writes, so the two stay interchangeable.
        tx.set(ref, { ...pick(data), updatedAt: FieldValue.serverTimestamp(), updatedBy: UPDATED_BY });
        return result;
      });
    },
  };
}

function missingDoc() {
  return new PlannerError(`The planner document (${PLANNER_DOC}) doesn't exist yet. Sign in to the app as the editor once to create it.`);
}

/* In-memory stand-in for tests. */
export function createMemoryStore(initial) {
  let doc = structuredClone(pick(normalizeData(initial)));
  return {
    async read() {
      return { data: structuredClone(doc), updatedAt: null, updatedBy: null };
    },
    async update(fn) {
      const before = structuredClone(doc);
      const data = structuredClone(doc);
      const result = await fn(data, before);
      doc = pick(data);
      return result;
    },
    snapshot: () => structuredClone(doc),
  };
}

/* ================= Backups ================= */
/* A copy of the whole planner is saved before every change. The newest `keep` files are kept. */
export function createBackups({ dir, keep = 100 }) {
  async function names() {
    try {
      return (await readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse();
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  return {
    dir,

    /* stamp is fixed per tool call, so a transaction retry overwrites its own file. */
    async save(data, reason, stamp) {
      await mkdir(dir, { recursive: true });
      const name = `${stamp.replace(/[:.]/g, '-')}_${reason}.json`;
      await writeFile(path.join(dir, name), JSON.stringify({ savedAt: stamp, reason, ...pick(data) }, null, 2));
      const old = (await names()).slice(keep);
      await Promise.all(old.map((f) => unlink(path.join(dir, f)).catch(() => {})));
      return name;
    },

    async list() {
      return names();
    },

    /* A backup name from list(), or a path to any JSON file (e.g. one from the app's Export button). */
    async load(ref) {
      const file = path.isAbsolute(ref) ? ref : path.join(dir, path.basename(ref));
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') throw new PlannerError(`No backup file at ${file}.`);
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new PlannerError(`${file} isn't valid JSON.`);
      }
    },
  };
}
