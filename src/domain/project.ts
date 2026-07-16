import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export interface Project extends Entity {
  name: string;
}

export function newProject(name: string): Project {
  return { id: newId(), name };
}
