/**
 * In-memory stand-in for the browser's raw `indexedDB` global (coverage campaign, 2026-10-21).
 * NOT a test file — imported by lib/ tests that need the REAL offline-store code to run.
 *
 * jsdom ships no IndexedDB and `fake-indexeddb` is not installed, so this replaces the
 * narrowest boundary there is: the `indexedDB` global itself. Nothing in the app is mocked.
 *
 * A simpler fake exists at routes/filter-management/hooks/__tests__/fake-indexeddb.ts. This
 * one adds what offline-store's own tests need to be faithful:
 *   - `open` succeeds only AFTER the versionchange transaction completes (the v3->v4 and
 *     v6->v7 cursor migrations finish before any caller reads), and an aborted upgrade
 *     fails the open and keeps the old version;
 *   - `db.transaction()` throws NotFoundError for an unknown store, and a readonly
 *     transaction refuses writes with ReadOnlyError, as the browser does;
 *   - error injection (`failNextOpen`, `failRequests`): a failed request fires its own
 *     `onerror`, bubbles to `tx.onerror`, then aborts the transaction (`tx.onabort`,
 *     writes rolled back, `oncomplete` never fires);
 *   - `getAll` / `getAllKeys` / cursors / index reads return rows in key order;
 *   - seeding a database at an OLD version, to exercise the upgrade path.
 * Callbacks fire on microtasks, so `vi.useFakeTimers()` does not stall them.
 * If `fake-indexeddb` is ever added as a devDependency, both fakes can be replaced by it.
 */
import { vi } from 'vitest';

export type Row = Record<string, any>;
type Key = string | number;

interface StoreDef { keyPath: string; rows: Map<Key, Row>; indexes: Map<string, string> }
export interface DbDef { version: number; stores: Map<string, StoreDef> }

export interface RequestFailure { store?: string; op?: string; times?: number; error?: Error }

export interface FakeIdb {
  /** Raw state: database name -> definition. */
  dbs: Map<string, DbDef>;
  /** Number of `indexedDB.open` calls made since install. */
  readonly opens: number;
  /** Rows of one store, in key order. */
  rows(store: string, db?: string): Row[];
  /** Object-store names of a database, sorted. */
  storeNames(db?: string): string[];
  /** Index name -> keyPath of one store. */
  indexes(store: string, db?: string): Record<string, string>;
  /** Write rows straight into an existing store (no request, no transaction). */
  seed(store: string, rows: Row[], db?: string): void;
  /** Create a database at `version` with the given stores, as an older app build left it. */
  seedDatabase(version: number, stores: Record<string, { keyPath: string; indexes?: Record<string, string>; rows?: Row[] }>, db?: string): void;
  /** The next `indexedDB.open` fails with `error`. */
  failNextOpen(error?: Error): void;
  /** Requests matching store/op fail (all of them, or the first `times`). */
  failRequests(match: RequestFailure): void;
  /** The next readwrite transaction to commit aborts with `error` and no error event, as on quota exhaustion. */
  abortNextCommit(error?: Error): void;
}

const APP_DB = 'digilog-offline';
const later = (fn: () => void) => { Promise.resolve().then(fn); };
const clone = <T>(v: T): T => (v === undefined ? v : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const domError = (name: string, message = name) => { const e = new Error(message); e.name = name; return e; };
const cmp = (a: Key, b: Key) => {
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1; // numbers sort before strings
  return a < b ? -1 : a > b ? 1 : 0;
};

class FakeRequest {
  result: any = undefined;
  error: Error | null = null;
  readyState: 'pending' | 'done' = 'pending';
  transaction: FakeTx | null = null;
  onsuccess: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onupgradeneeded: ((e?: any) => void) | null = null;
  onblocked: ((e?: any) => void) | null = null;
}

class FakeTx {
  oncomplete: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onabort: ((e?: any) => void) | null = null;
  error: Error | null = null;
  private pending = 0;
  private finished = false;
  private snapshots = new Map<string, Map<Key, Row>>();
  private doneHooks: Array<(ok: boolean) => void> = [];

  constructor(
    private db: DbDef,
    private scope: string[] | 'all',
    readonly mode: 'readonly' | 'readwrite' | 'versionchange',
    private ctl: Control,
  ) { this.settle(); }

  get active() { return !this.finished; }

  /** Completion check: two microtask hops lets a callback queue follow-up requests first. */
  private settle() {
    later(() => later(() => {
      if (this.pending !== 0 || this.finished) return;
      // A commit the browser refuses (quota exhausted) aborts with NO error event.
      const refused = this.mode === 'readwrite' ? this.ctl.takeCommitFailure() : null;
      if (refused) { this.abort(refused); return; }
      this.finished = true;
      this.oncomplete?.({ target: this });
      for (const h of this.doneHooks) h(true);
    }));
  }

  whenDone(h: (ok: boolean) => void) { this.doneHooks.push(h); }

  snapshot(store: string) {
    if (this.snapshots.has(store)) return;
    const def = this.db.stores.get(store);
    if (def) this.snapshots.set(store, new Map(def.rows));
  }

  abort(error: Error) {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    for (const [name, rows] of this.snapshots) {
      const def = this.db.stores.get(name);
      if (def) def.rows = rows;
    }
    this.onabort?.({ target: this });
    for (const h of this.doneHooks) h(false);
  }

  run(req: FakeRequest, store: string, op: string, compute: () => any): FakeRequest {
    if (this.finished) throw domError('TransactionInactiveError');
    this.pending += 1;
    later(() => {
      if (this.finished) { // aborted while queued: the browser fails every queued request
        req.readyState = 'done';
        req.error = domError('AbortError');
        req.onerror?.({ target: req });
        return;
      }
      const injected = this.ctl.match(store, op);
      try {
        if (injected) throw injected;
        req.result = compute();
        req.readyState = 'done';
        req.onsuccess?.({ target: req });
      } catch (e) {
        req.readyState = 'done';
        req.error = e as Error;
        const evt = { target: req };
        req.onerror?.(evt);
        this.error = e as Error;
        this.onerror?.(evt); // the error event bubbles to the transaction...
        this.abort(e as Error); // ...and, not prevented, aborts it
        return;
      }
      this.pending -= 1;
      if (this.pending === 0) this.settle();
    });
    return req;
  }

  objectStore(name: string) {
    if (this.finished) throw domError('InvalidStateError');
    const inScope = this.scope === 'all' || this.scope.includes(name);
    const def = this.db.stores.get(name);
    if (!inScope || !def) throw domError('NotFoundError', `No objectStore named ${name} in this transaction`);
    return new FakeStore(name, def, this);
  }
}

class FakeStore {
  constructor(private name: string, private def: StoreDef, private tx: FakeTx) {}

  private write(op: string, fn: () => any) {
    if (this.tx.mode === 'readonly') throw domError('ReadOnlyError');
    this.tx.snapshot(this.name);
    return this.tx.run(new FakeRequest(), this.name, op, fn);
  }
  private read(op: string, fn: () => any) { return this.tx.run(new FakeRequest(), this.name, op, fn); }
  private sortedKeys() { return [...this.def.rows.keys()].sort(cmp); }

  createIndex(name: string, keyPath: string) {
    if (this.tx.mode !== 'versionchange') throw domError('InvalidStateError');
    this.def.indexes.set(name, keyPath);
    return { name, keyPath };
  }
  get indexNames() { return { contains: (n: string) => this.def.indexes.has(n) }; }

  get(key: Key) { return this.read('get', () => clone(this.def.rows.get(key))); }
  getAll() { return this.read('getAll', () => this.sortedKeys().map((k) => clone(this.def.rows.get(k)))); }
  getAllKeys() { return this.read('getAllKeys', () => this.sortedKeys()); }
  count() { return this.read('count', () => this.def.rows.size); }
  put(value: Row) {
    const key = value?.[this.def.keyPath];
    if (key === undefined || key === null) throw domError('DataError', `put() without keyPath ${this.def.keyPath}`);
    return this.write('put', () => { this.def.rows.set(key, clone(value)); return key; });
  }
  add(value: Row) {
    const key = value?.[this.def.keyPath];
    return this.write('add', () => {
      if (this.def.rows.has(key)) throw domError('ConstraintError');
      this.def.rows.set(key, clone(value));
      return key;
    });
  }
  delete(key: Key) { return this.write('delete', () => { this.def.rows.delete(key); return undefined; }); }
  clear() { return this.write('clear', () => { this.def.rows.clear(); return undefined; }); }

  index(name: string) {
    const field = this.def.indexes.get(name);
    if (!field) throw domError('NotFoundError', `No index named ${name}`);
    return {
      getAll: (value?: Key) => this.read(`index:${name}.getAll`, () => this.sortedKeys()
        .map((k) => this.def.rows.get(k)!)
        .filter((r) => value === undefined || r[field] === value)
        .map(clone)),
    };
  }

  /** IDB reuses ONE request for every cursor step: onsuccess fires once per row, then with null. */
  openCursor() {
    const req = new FakeRequest();
    const keys = this.sortedKeys();
    let i = 0;
    const step = () => {
      this.tx.run(req, this.name, 'openCursor', () => {
        while (i < keys.length && !this.def.rows.has(keys[i])) i += 1;
        if (i >= keys.length) return null;
        const key = keys[i];
        return {
          key,
          primaryKey: key,
          value: clone(this.def.rows.get(key)),
          update: (v: Row) => this.write('cursor.update', () => { this.def.rows.set(key, clone(v)); return key; }),
          delete: () => this.write('cursor.delete', () => { this.def.rows.delete(key); return undefined; }),
          continue: () => { i += 1; step(); },
        };
      });
    };
    step();
    return req;
  }
}

class Control {
  failures: RequestFailure[] = [];
  openFailure: Error | null = null;
  commitFailure: Error | null = null;
  takeCommitFailure(): Error | null {
    const e = this.commitFailure;
    this.commitFailure = null;
    return e;
  }
  match(store: string, op: string): Error | null {
    for (const f of this.failures) {
      if (f.store && f.store !== store) continue;
      if (f.op && f.op !== op) continue;
      if (f.times !== undefined) {
        if (f.times <= 0) continue;
        f.times -= 1;
      }
      return f.error ?? domError('UnknownError', `injected failure: ${store}.${op}`);
    }
    return null;
  }
}

/** Installs a fresh in-memory `indexedDB` global. Undo with `vi.unstubAllGlobals()`. */
export function installFakeIdb(): FakeIdb {
  const dbs = new Map<string, DbDef>();
  const ctl = new Control();
  let opens = 0;

  const connection = (def: DbDef, upgradeTx: () => FakeTx | null) => ({
    get version() { return def.version; },
    get objectStoreNames() {
      const names = [...def.stores.keys()].sort();
      return Object.assign(names, { contains: (n: string) => def.stores.has(n) });
    },
    createObjectStore(name: string, opts: { keyPath: string }) {
      const tx = upgradeTx();
      if (!tx || !tx.active) throw domError('InvalidStateError', 'createObjectStore outside versionchange');
      if (def.stores.has(name)) throw domError('ConstraintError', `objectStore ${name} exists`);
      const s: StoreDef = { keyPath: opts.keyPath, rows: new Map(), indexes: new Map() };
      def.stores.set(name, s);
      return new FakeStore(name, s, tx);
    },
    transaction(names: string | string[], mode: 'readonly' | 'readwrite' = 'readonly') {
      const list = Array.isArray(names) ? names : [names];
      for (const n of list) if (!def.stores.has(n)) throw domError('NotFoundError', `No objectStore named ${n}`);
      return new FakeTx(def, list, mode, ctl);
    },
    close() {},
  });

  const factory = {
    open(name: string, version = 1) {
      opens += 1;
      const req = new FakeRequest();
      later(() => {
        if (ctl.openFailure) {
          req.error = ctl.openFailure;
          ctl.openFailure = null;
          req.readyState = 'done';
          req.onerror?.({ target: req });
          return;
        }
        let def = dbs.get(name);
        if (!def) { def = { version: 0, stores: new Map() }; dbs.set(name, def); }
        const oldVersion = def.version;
        if (version < oldVersion) {
          req.error = domError('VersionError');
          req.onerror?.({ target: req });
          return;
        }
        if (oldVersion === version) {
          req.result = connection(def, () => null);
          req.readyState = 'done';
          req.onsuccess?.({ target: req });
          return;
        }
        const d = def;
        const before = new Map([...d.stores].map(([k, s]) => [k, { ...s, rows: new Map(s.rows), indexes: new Map(s.indexes) }]));
        const tx = new FakeTx(d, 'all', 'versionchange', ctl);
        req.result = connection(d, () => tx);
        req.transaction = tx;
        d.version = version;
        tx.whenDone((ok) => {
          req.transaction = null;
          req.readyState = 'done';
          if (ok) { req.onsuccess?.({ target: req }); return; }
          d.version = oldVersion; // an aborted upgrade leaves the database as it was
          d.stores = before;
          req.result = undefined;
          req.error = domError('AbortError', 'version change transaction was aborted');
          req.onerror?.({ target: req });
        });
        req.onupgradeneeded?.({ oldVersion, newVersion: version, target: req });
      });
      return req;
    },
    deleteDatabase(name: string) { dbs.delete(name); const r = new FakeRequest(); later(() => r.onsuccess?.({ target: r })); return r; },
  };
  vi.stubGlobal('indexedDB', factory);

  const store = (s: string, db: string) => {
    const d = dbs.get(db);
    const st = d?.stores.get(s);
    if (!st) throw new Error(`fake-idb: no store ${db}/${s} (open the database first)`);
    return st;
  };
  return {
    dbs,
    get opens() { return opens; },
    rows: (s, db = APP_DB) => { const st = store(s, db); return [...st.rows.keys()].sort(cmp).map((k) => clone(st.rows.get(k)!)); },
    storeNames: (db = APP_DB) => [...(dbs.get(db)?.stores.keys() ?? [])].sort(),
    indexes: (s, db = APP_DB) => Object.fromEntries(store(s, db).indexes),
    seed: (s, rows, db = APP_DB) => { const st = store(s, db); for (const r of rows) st.rows.set(r[st.keyPath], clone(r)); },
    seedDatabase: (version, stores, db = APP_DB) => {
      const def: DbDef = { version, stores: new Map() };
      for (const [n, cfg] of Object.entries(stores)) {
        const rows = new Map<Key, Row>();
        for (const r of cfg.rows ?? []) rows.set(r[cfg.keyPath], clone(r));
        def.stores.set(n, { keyPath: cfg.keyPath, rows, indexes: new Map(Object.entries(cfg.indexes ?? {})) });
      }
      dbs.set(db, def);
    },
    failNextOpen: (error = domError('UnknownError', 'injected open failure')) => { ctl.openFailure = error; },
    failRequests: (match) => { ctl.failures.push({ ...match }); },
    abortNextCommit: (error = domError('QuotaExceededError', 'injected commit abort')) => { ctl.commitFailure = error; },
  };
}
