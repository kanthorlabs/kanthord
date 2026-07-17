import type { DatabaseSync } from "node:sqlite";

import type { UnitOfWork } from "../port.ts";

/** `node:sqlite` adapter for the `UnitOfWork` port. */
export class SqliteUnitOfWork implements UnitOfWork {
  readonly #db: DatabaseSync;
  #inTransaction = false;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  transaction<T>(fn: () => T): T {
    if (this.#inTransaction) {
      throw new Error("nested transaction not supported");
    }
    this.#inTransaction = true;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      this.#inTransaction = false;
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      this.#inTransaction = false;
      throw err;
    }
  }
}
