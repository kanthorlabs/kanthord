import type { DatabaseSync } from "node:sqlite";

import type { Transactor } from "../port.ts";

/** `node:sqlite` adapter for the `Transactor` port. */
export class SqliteTransactor implements Transactor {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  run<T>(work: () => T): T {
    this.#db.exec("BEGIN");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }
}
