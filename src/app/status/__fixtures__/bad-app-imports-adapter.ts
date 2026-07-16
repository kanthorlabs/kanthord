// DELIBERATELY ILLEGAL — a use case (app/) importing a concrete adapter, which
// AGENTS.md forbids (only main.ts imports adapters). This fixture exists solely
// to prove the boundary rule fires; see ../boundary-proof.test.ts. It lives
// under __fixtures__/, which eslint.config.js ignores, so `npm run lint` stays
// green; the proof test lints it explicitly with --no-ignore.
import { SqliteStatusStore } from "../../../storage/sqlite/sqlite-status-store.ts";

export const leak = SqliteStatusStore;
