// src/apps/cli/serve.ts — pure --port parsing for the `serve` leaf (Story 07).
// Mirrors src/apps/cli/queue.ts: the pure, unit-testable logic behind
// commands/serve.ts. No koa, no server import — stays testable without a
// running server.

export const DEFAULT_PORT = 4100;

export class InvalidPortError extends Error {}

/** Parse --port. Default 4100; 0 allowed (ephemeral). Throws InvalidPortError. */
export function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPortError("--port must be an integer between 0 and 65535");
  }
  const parsed = Number(raw);
  if (parsed > 65535) {
    throw new InvalidPortError("--port must be an integer between 0 and 65535");
  }
  return parsed;
}
