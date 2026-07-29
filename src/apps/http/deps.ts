import type { HttpLogger } from "./logger.ts";

/**
 * What the HTTP routes need. One field per capability, added by the epic that
 * adds the route using it. Not CliDeps, not a god bag.
 */
export interface HttpDeps {
  readonly logger: HttpLogger;
}
