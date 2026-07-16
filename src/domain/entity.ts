import { monotonicFactory } from "ulid";

const _ulid = monotonicFactory();

export interface Entity {
  id: string;
}

export function newId(): string {
  return _ulid();
}
