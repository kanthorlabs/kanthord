import type {
  Resource,
  Repository,
  Credential,
  Notification,
  AIProvider,
  Filesystem,
  RepositoryAuth,
} from "../../domain/resource.ts";

// ---------------------------------------------------------------------------
// ResourceView — structural omission of credential.value
// ---------------------------------------------------------------------------

export type CredentialView = {
  type: "credential";
  id: string;
  projectId?: string;
  name: string;
  provider: string;
};

export type RepositoryView = {
  type: "repository";
  id: string;
  projectId?: string;
  name: string;
  remoteUrl: string;
  branch: string;
  path: string;
  auth: RepositoryAuth;
};

export type NotificationView = {
  type: "notification";
  id: string;
  projectId?: string;
  name: string;
  provider: "slack" | "telegram";
  destination: string;
};

export type AIProviderView = {
  type: "ai_provider";
  id: string;
  projectId?: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  effort?: string;
};

export type FilesystemView = {
  type: "filesystem";
  id: string;
  projectId?: string;
  name: string;
  path: string;
};

export type ResourceView =
  | CredentialView
  | RepositoryView
  | NotificationView
  | AIProviderView
  | FilesystemView;

// ---------------------------------------------------------------------------
// toResourceView — explicit field-by-field construction (no spread)
// ---------------------------------------------------------------------------

export function toResourceView(resource: Resource): ResourceView {
  switch (resource.type) {
    case "credential": {
      const r = resource as Credential;
      // Explicitly list fields — never spread — so `value` is structurally absent.
      return {
        type: "credential",
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        provider: r.provider,
      };
    }
    case "repository": {
      const r = resource as Repository;
      return {
        type: "repository",
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        remoteUrl: r.remoteUrl,
        branch: r.branch,
        path: r.path,
        auth: r.auth,
      };
    }
    case "notification": {
      const r = resource as Notification;
      return {
        type: "notification",
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        provider: r.provider,
        destination: r.destination,
      };
    }
    case "ai_provider": {
      const r = resource as AIProvider;
      const view: AIProviderView = {
        type: "ai_provider",
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        provider: r.provider,
        model: r.model,
      };
      if (r.baseUrl !== undefined) view.baseUrl = r.baseUrl;
      if (r.effort !== undefined) view.effort = r.effort;
      return view;
    }
    case "filesystem": {
      const r = resource as Filesystem;
      return {
        type: "filesystem",
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        path: r.path,
      };
    }
  }
}
