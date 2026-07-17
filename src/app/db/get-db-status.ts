import type { StatusStore } from "../../storage/port.ts";

/** Shape returned by GetDbStatus.execute(). */
export interface DbStatus {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  tables: Array<{ name: string; rows: number }>;
}

/** Query use case: read the store's health and shape it for the CLI. */
export class GetDbStatus {
  readonly #store: StatusStore;

  constructor(store: StatusStore) {
    this.#store = store;
  }

  async execute(): Promise<DbStatus> {
    return {
      dbPath: this.#store.path,
      schemaVersion: this.#store.schemaVersion(),
      journalMode: this.#store.journalMode(),
      tables: this.#store.tables(),
    };
  }
}
