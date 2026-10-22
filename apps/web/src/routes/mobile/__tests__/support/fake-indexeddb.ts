/**
 * Minimal in-memory IndexedDB for the tablet-app tests (coverage campaign, 2026-10-21).
 * NOT a test file (no .test. in the name, lives under __tests__ so it is excluded from coverage).
 *
 * A private COPY of routes/filter-management/hooks/__tests__/fake-indexeddb.ts (another
 * coverage agent's helper, untracked at the time of writing). Copied rather than imported
 * so a concurrent edit there cannot break these suites; consolidate when both land.
 *
 * jsdom ships no `indexedDB` and `fake-indexeddb` is not installed, so this stands in for
 * the BROWSER API only: the real lib/offline-store.ts (and everything above it: offline-cache,
 * local-context, use-offline, the filter-ops core) runs unmodified on top of it.
 */
import { vi } from 'vitest';

type Row = Record<string, any>;
interface StoreDef { keyPath: string; rows: Map<any, Row>; indexes: Map<string, string> }
interface DbDef { version: number; stores: Map<string, StoreDef> }

const later = (fn: () => void) => { Promise.resolve().then(fn); };
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeRequest {
  result: any = undefined;
  error: any = null;
  onsuccess: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  transaction: any = null;
  onupgradeneeded: ((e?: any) => void) | null = null;
}

class FakeTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: any = null;
  private pending = 0;
  private done = false;
  constructor(private db: DbDef) { this.settle(); }
  /** Schedules completion once every request queued on this tx has fired. */
  private settle() {
    later(() => later(() => {
      if (this.pending === 0 && !this.done) { this.done = true; this.oncomplete?.(); }
    }));
  }
  run(req: FakeRequest, compute: () => any) {
    this.pending += 1;
    later(() => {
      try { req.result = compute(); req.onsuccess?.({ target: req }); } catch (e) { req.error = e; req.onerror?.({ target: req }); }
      this.pending -= 1;
      if (this.pending === 0) this.settle();
    });
    return req;
  }
  objectStore(name: string) {
    const def = this.db.stores.get(name);
    if (!def) throw new Error(`NotFoundError: object store ${name}`);
    return new FakeStore(def, this);
  }
}

class FakeStore {
  constructor(private def: StoreDef, private tx: FakeTx) {}
  createIndex(name: string, keyPath: string) { this.def.indexes.set(name, keyPath); return {}; }
  get(key: any) { return this.tx.run(new FakeRequest(), () => clone(this.def.rows.get(key))); }
  getAll() { return this.tx.run(new FakeRequest(), () => [...this.def.rows.values()].map(clone)); }
  getAllKeys() { return this.tx.run(new FakeRequest(), () => [...this.def.rows.keys()]); }
  put(value: Row) { const k = value[this.def.keyPath]; return this.tx.run(new FakeRequest(), () => { this.def.rows.set(k, clone(value)); return k; }); }
  add(value: Row) { return this.put(value); }
  delete(key: any) { return this.tx.run(new FakeRequest(), () => { this.def.rows.delete(key); return undefined; }); }
  clear() { return this.tx.run(new FakeRequest(), () => { this.def.rows.clear(); return undefined; }); }
  count() { return this.tx.run(new FakeRequest(), () => this.def.rows.size); }
  index(name: string) {
    const field = this.def.indexes.get(name) ?? name;
    return {
      getAll: (value?: any) => this.tx.run(new FakeRequest(), () =>
        [...this.def.rows.values()].filter((r) => value === undefined || r[field] === value).map(clone)),
    };
  }
  openCursor() {
    const req = new FakeRequest();
    const keys = [...this.def.rows.keys()];
    let i = 0;
    const step = () => this.tx.run(req, () => {
      if (i >= keys.length) return null;
      const key = keys[i];
      return {
        key,
        value: clone(this.def.rows.get(key)),
        update: (v: Row) => { this.def.rows.set(key, clone(v)); },
        delete: () => { this.def.rows.delete(key); },
        continue: () => { i += 1; step(); },
      };
    });
    step();
    return req;
  }
}

export interface FakeIdb {
  /** Raw access for seeding / asserting: database → store → rows. */
  dbs: Map<string, DbDef>;
  rows(store: string, db?: string): Row[];
  seed(store: string, rows: Row[], db?: string): void;
}

/** Installs a fresh in-memory `indexedDB` global. Undo with vi.unstubAllGlobals(). */
export function installFakeIndexedDB(): FakeIdb {
  const dbs = new Map<string, DbDef>();
  const makeDb = (def: DbDef) => ({
    get version() { return def.version; },
    objectStoreNames: { contains: (n: string) => def.stores.has(n) },
    createObjectStore: (name: string, opts: { keyPath: string }) => {
      const s: StoreDef = { keyPath: opts.keyPath, rows: new Map(), indexes: new Map() };
      def.stores.set(name, s);
      return new FakeStore(s, new FakeTx(def));
    },
    transaction: (_names: string | string[]) => new FakeTx(def),
    close: () => {},
  });
  const indexedDB = {
    open(name: string, version = 1) {
      const req = new FakeRequest();
      later(() => {
        let def = dbs.get(name);
        const oldVersion = def?.version ?? 0;
        if (!def) { def = { version: version, stores: new Map() }; dbs.set(name, def); }
        req.result = makeDb(def);
        if (oldVersion < version) {
          def.version = version;
          req.transaction = new FakeTx(def);
          req.onupgradeneeded?.({ oldVersion, newVersion: version, target: req });
        }
        later(() => req.onsuccess?.({ target: req }));
      });
      return req;
    },
    deleteDatabase(name: string) { dbs.delete(name); return new FakeRequest(); },
  };
  vi.stubGlobal('indexedDB', indexedDB);
  const store = (s: string, db: string) => {
    const d = dbs.get(db);
    if (!d || !d.stores.has(s)) throw new Error(`fake idb: no store ${db}/${s} (open the db first)`);
    return d.stores.get(s)!;
  };
  return {
    dbs,
    rows: (s, db = 'digilog-offline') => [...store(s, db).rows.values()],
    seed: (s, rows, db = 'digilog-offline') => { const st = store(s, db); for (const r of rows) st.rows.set(r[st.keyPath], clone(r)); },
  };
}

/** Opens the app DB through offline-store's own upgrade so its real stores exist before seeding. */
export async function openAppDb(): Promise<void> {
  const { getCachedData } = await import('@/lib/offline-store');
  await getCachedData('__warmup__');
}

/** A cache-store row in the shape offline-store writes. */
export function cacheRow(key: string, data: unknown, ttlMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  return { key, data, cachedAt: new Date(now).toISOString(), lastAccessedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
}
