import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export interface Initiative extends Entity {
  projectId: string;
  name: string;
}

export interface Objective extends Entity {
  initiativeId: string;
  name: string;
}

export function newInitiative(projectId: string, name: string): Initiative {
  return { id: newId(), projectId, name };
}

export function newObjective(initiativeId: string, name: string): Objective {
  return { id: newId(), initiativeId, name };
}
