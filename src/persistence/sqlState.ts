import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  recordPersistenceError,
  recordPersistenceSuccess,
} from "./health";

const STORAGE_KEY = "coda2.sqlite.b64.v1";
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

let sqlRuntimePromise: Promise<SqlJsStatic> | undefined;
let dbPromise: Promise<Database> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

export type SqlSnapshotMeta = {
  key: string;
  updatedAt: number;
  jsonBytes: number;
};

export class PersistenceWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceWriteError";
  }
}

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue
    .catch((err) => {
      recordPersistenceError(err);
    })
    .then(async () => {
      try {
        await task();
        recordPersistenceSuccess();
      } catch (err) {
        recordPersistenceError(err);
        throw err;
      }
    });
  return writeQueue;
}

export async function loadSqlSnapshot<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const result = db.exec(
    "SELECT json FROM state_snapshots WHERE key = ? LIMIT 1;",
    [key]
  );
  const json = result[0]?.values[0]?.[0];
  if (typeof json !== "string") return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export function saveSqlSnapshot<T>(key: string, value: T): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDb();
    db.run(
      `INSERT INTO state_snapshots(key, json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         json = excluded.json,
         updated_at = excluded.updated_at;`,
      [key, JSON.stringify(value), Date.now()]
    );
    persistDb(db);
  });
}

export function deleteSqlSnapshot(key: string): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDb();
    db.run("DELETE FROM state_snapshots WHERE key = ?;", [key]);
    persistDb(db);
  });
}

export function clearSqlSnapshots(): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDb();
    db.run("DELETE FROM state_snapshots;");
    persistDb(db);
  });
}

export async function listSqlSnapshotMeta(): Promise<SqlSnapshotMeta[]> {
  const db = await getDb();
  const result = db.exec(
    "SELECT key, updated_at, length(json) FROM state_snapshots ORDER BY key ASC;"
  );
  const rows = result[0]?.values ?? [];
  return rows
    .map((row) => {
      const key = row[0];
      const updatedAt = row[1];
      const jsonBytes = row[2];
      if (
        typeof key !== "string" ||
        typeof updatedAt !== "number" ||
        typeof jsonBytes !== "number"
      ) {
        return undefined;
      }
      return { key, updatedAt, jsonBytes };
    })
    .filter((item): item is SqlSnapshotMeta => item !== undefined);
}

export function exportSqlDatabaseBytes(): Uint8Array | undefined {
  const encoded = readStorage();
  if (!encoded || encoded.length === 0) return undefined;
  try {
    return base64ToBytes(encoded);
  } catch {
    return undefined;
  }
}

export async function importSqlDatabaseBytes(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error(
      `Import exceeds ${MAX_IMPORT_BYTES} bytes. Export a smaller snapshot or clear old state first.`
    );
  }

  const SQL = await getSqlRuntime();
  const db = new SQL.Database(bytes);
  db.run(`CREATE TABLE IF NOT EXISTS state_snapshots(
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  persistDb(db);
  db.close();
  dbPromise = undefined;
}

export function getSqlStorageBytes(): number {
  const encoded = readStorage();
  if (!encoded || encoded.length === 0) return 0;
  return Math.floor((encoded.length * 3) / 4);
}

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await getSqlRuntime();
      const encoded = readStorage();
      const db =
        encoded && encoded.length > 0
          ? new SQL.Database(base64ToBytes(encoded))
          : new SQL.Database();
      db.run(`CREATE TABLE IF NOT EXISTS state_snapshots(
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );`);
      return db;
    })();
  }
  return dbPromise;
}

async function getSqlRuntime(): Promise<SqlJsStatic> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }
  return sqlRuntimePromise;
}

function persistDb(db: Database): void {
  const bytes = db.export();
  writeStorage(bytesToBase64(bytes));
}

function readStorage(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "QuotaExceededError"
        ? "Browser storage quota exceeded. Export your database, clear site data, then import again."
        : err instanceof Error
          ? err.message
          : String(err);
    throw new PersistenceWriteError(message);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
