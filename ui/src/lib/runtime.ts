// ui/src/lib/runtime.ts — EPIC 026 rule R3 + R6: the runtime config seam.
//
// R3: one transport seam. This module answers "where is the API", and
// `api-client.ts` is the only module that calls `fetch`.
//
// R6: no browser global is read at module scope. `apiBaseUrl` is a FUNCTION, not
// a const, so the value is read when a request is made — after the Electron main
// process (or a test) has injected it. A module-scope read would capture
// `undefined` at import time and no later injection could correct it.

/** What a host shell may inject. Absent in web mode, where the API is same-origin. */
export interface KanthordRuntime {
  /**
   * Origin (or origin + path prefix) the API lives at, with no trailing slash.
   * Empty means same origin, which is what every mode uses today: decision 6
   * has Electron load the daemon's own origin, so no host list is needed.
   */
  readonly apiBaseUrl?: string;
}

declare global {
  var kanthord: KanthordRuntime | undefined;
}

/** The API base. `""` means same origin. Read per call, never at module scope. */
export function apiBaseUrl(): string {
  const injected = globalThis.kanthord?.apiBaseUrl;
  if (injected === undefined || injected === "") {
    return "";
  }
  return injected.endsWith("/") ? injected.slice(0, -1) : injected;
}
