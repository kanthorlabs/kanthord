import type { StatusStore } from "../../storage/port.ts";

/** The four fields the `status` command reports. */
export interface Status {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  taskCount: number;
}

/** Query use case: read the store's health and shape it for the CLI. */
export class GetStatus {
  readonly #store: StatusStore;

  constructor(store: StatusStore) {
    this.#store = store;
  }

  execute(): Status {
    return {
      dbPath: this.#store.path,
      schemaVersion: this.#store.schemaVersion(),
      journalMode: this.#store.journalMode(),
      taskCount: this.#store.taskCount(),
    };
  }
}
