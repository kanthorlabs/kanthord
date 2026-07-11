import { monotonicFactory } from "ulid";

const monotonic = monotonicFactory();

export function newId(prefix: string): string {
  return `${prefix}_${monotonic()}`;
}

export const ID_PREFIX = {
  account: "acc",
  op: "op",
  event: "evt",
  call: "call",
  reservation: "rsv",
} as const;
