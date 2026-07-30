import type {
  ResourceView,
  CredentialView,
  RepositoryView,
  NotificationView,
  FilesystemView,
} from "../../../app/resource/resource-view.ts";
import { repositoryAuthView, type RepositoryAuthView } from "./shared.ts";

/** Mirrors ResourceType (src/domain/resource.ts:11); apps/ may not import domain/. */
export type HttpResourceType =
  "repository" | "credential" | "notification" | "filesystem";

export interface CredentialDtoView {
  readonly type: "credential";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly provider: string;
}

export interface RepositoryDtoView {
  readonly type: "repository";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly branch: string;
  readonly path: string;
  readonly auth: RepositoryAuthView;
  readonly publication: {
    readonly state: string;
    readonly remoteOID: string | null;
  } | null;
}

export interface NotificationDtoView {
  readonly type: "notification";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly provider: string;
  readonly destination: string;
}

export interface FilesystemDtoView {
  readonly type: "filesystem";
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly path: string;
}

export type ResourceDtoView =
  | CredentialDtoView
  | RepositoryDtoView
  | NotificationDtoView
  | FilesystemDtoView;

function credentialView(r: CredentialView): CredentialDtoView {
  return {
    type: "credential",
    id: r.id,
    ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
    name: r.name,
    provider: r.provider,
  };
}

function repositoryDtoView(r: RepositoryView): RepositoryDtoView {
  return {
    type: "repository",
    id: r.id,
    ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
    name: r.name,
    remoteUrl: r.remoteUrl,
    branch: r.branch,
    path: r.path,
    auth: repositoryAuthView(r.auth),
    publication:
      r.publication === null
        ? null
        : { state: r.publication.state, remoteOID: r.publication.remoteOID },
  };
}

function notificationView(r: NotificationView): NotificationDtoView {
  return {
    type: "notification",
    id: r.id,
    ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
    name: r.name,
    provider: r.provider,
    destination: r.destination,
  };
}

function filesystemView(r: FilesystemView): FilesystemDtoView {
  return {
    type: "filesystem",
    id: r.id,
    ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
    name: r.name,
    path: r.path,
  };
}

export function resourceView(result: ResourceView): ResourceDtoView {
  switch (result.type) {
    case "credential":
      return credentialView(result);
    case "repository":
      return repositoryDtoView(result);
    case "notification":
      return notificationView(result);
    case "filesystem":
      return filesystemView(result);
  }
}
