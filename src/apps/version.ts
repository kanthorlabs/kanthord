import { readFileSync } from "node:fs";

/**
 * The single source of the program version. `src/apps/cli/index.ts` and the
 * HTTP app's `/healthz` row both read this constant, so the API version and
 * the CLI version are equal by construction.
 */
export const packageVersion = (
  JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
