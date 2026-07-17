/**
 * Minimal `node:sqlite` compatibility shim backed by `bun:sqlite`.
 *
 * Bun does not implement the `node:sqlite` built-in module. OpenConnector's
 * SQLite runtime store only uses `DatabaseSync` with `exec` / `prepare` /
 * `close` and statement `all` / `get` / `run` with positional `?` params,
 * which map 1:1 onto `bun:sqlite`.
 *
 * The build script copies this file into the vendored upstream tree at
 * `src/server/storage/node-sqlite-shim.ts` and rewrites the store's
 * `node:sqlite` import to point here.
 */

import { Database, type Statement } from "bun:sqlite";

type SqlValue = string | number | bigint | Uint8Array | null;

export interface StatementResultingChanges {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

class StatementSyncShim {
  #stmt: Statement;

  constructor(stmt: Statement) {
    this.#stmt = stmt;
  }

  all(...params: SqlValue[]): unknown[] {
    return this.#stmt.all(...(params as never[]));
  }

  get(...params: SqlValue[]): unknown {
    return this.#stmt.get(...(params as never[])) ?? undefined;
  }

  run(...params: SqlValue[]): StatementResultingChanges {
    const result = this.#stmt.run(...(params as never[]));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
}

export class DatabaseSync {
  #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { create: true });
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  prepare(sql: string): StatementSyncShim {
    return new StatementSyncShim(this.#db.prepare(sql));
  }

  close(): void {
    this.#db.close();
  }
}
