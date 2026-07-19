import { monotonicFactory } from "ulid";

const _ulid = monotonicFactory();

export interface Entity {
  id: string;
  /** The project this entity belongs to. Optional on the base interface because
   *  some entities (e.g. Project itself) are roots; domain helpers that need it
   *  require it explicitly on their concrete type. */
  projectId?: string;
}

export function newId(): string {
  return _ulid();
}
