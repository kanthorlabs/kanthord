import type { Entity } from "./entity.ts";

export const RESOURCE_TYPES = [
  "repository",
  "credential",
  "notification",
  "ai_provider",
  "filesystem",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface Repository extends Entity {
  type: "repository";
  name: string;
  organization: string;
  branch: string;
  path: string;
}

export interface Credential extends Entity {
  type: "credential";
  name: string;
  provider: string;
  value: string;
}

export interface Notification extends Entity {
  type: "notification";
  name: string;
  provider: "slack" | "telegram";
  destination: string;
}

export interface AIProvider extends Entity {
  type: "ai_provider";
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface Filesystem extends Entity {
  type: "filesystem";
  name: string;
  path: string;
}

export type Resource =
  | Repository
  | Credential
  | Notification
  | AIProvider
  | Filesystem;

export function isRepository(r: Resource): r is Repository {
  return r.type === "repository";
}

export function isCredential(r: Resource): r is Credential {
  return r.type === "credential";
}

export function isNotification(r: Resource): r is Notification {
  return r.type === "notification";
}

export function isAIProvider(r: Resource): r is AIProvider {
  return r.type === "ai_provider";
}

export function isFilesystem(r: Resource): r is Filesystem {
  return r.type === "filesystem";
}
