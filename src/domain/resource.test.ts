import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOURCE_TYPES,
  isRepository,
  isCredential,
  isNotification,
  isFilesystem,
  buildResource,
  ResourceValidationError,
  UnknownResourceTypeError,
  EmbeddedCredentialError,
  hasEmbeddedUserinfo,
  isInsecureEndpoint,
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
  CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS,
} from "./resource.ts";
import type {
  Repository,
  Credential,
  Notification,
  Filesystem,
  RepositoryAuth,
} from "./resource.ts";

const repo: Repository = {
  id: "01H000000000000000000000AA",
  type: "repository",
  name: "kanthord",
  remoteUrl: "https://github.com/kanthorlabs/kanthord.git",
  branch: "main",
  path: "/home/dev/kanthord",
  auth: { kind: "ambient" },
};

const cred: Credential = {
  id: "01H000000000000000000000BB",
  type: "credential",
  name: "github-token",
  provider: "github",
  value: "ghp_secret",
};

const notif: Notification = {
  id: "01H000000000000000000000CC",
  type: "notification",
  name: "alerts",
  provider: "slack",
  destination: "#general",
};

const fs: Filesystem = {
  id: "01H000000000000000000000EE",
  type: "filesystem",
  name: "workspace",
  path: "/workspace",
};

test("RESOURCE_TYPES lists exactly the four literals in order", () => {
  assert.deepEqual(RESOURCE_TYPES, [
    "repository",
    "credential",
    "notification",
    "filesystem",
  ]);
});

test("isRepository returns true only for Repository variant", () => {
  assert.equal(isRepository(repo), true);
  assert.equal(isCredential(repo), false);
  assert.equal(isNotification(repo), false);
  assert.equal(isFilesystem(repo), false);
});

test("isCredential returns true only for Credential variant", () => {
  assert.equal(isRepository(cred), false);
  assert.equal(isCredential(cred), true);
  assert.equal(isNotification(cred), false);
  assert.equal(isFilesystem(cred), false);
});

test("isNotification returns true only for Notification variant", () => {
  assert.equal(isRepository(notif), false);
  assert.equal(isCredential(notif), false);
  assert.equal(isNotification(notif), true);
  assert.equal(isFilesystem(notif), false);
});

test("isFilesystem returns true only for Filesystem variant", () => {
  assert.equal(isRepository(fs), false);
  assert.equal(isCredential(fs), false);
  assert.equal(isNotification(fs), false);
  assert.equal(isFilesystem(fs), true);
});

test("guards narrow to vendor fields at compile time", () => {
  // Compile-time proof: after narrowing, vendor fields are readable.
  // If this file typechecks, the narrowing works.
  if (isRepository(repo)) {
    const _remoteUrl: string = repo.remoteUrl;
    const _branch: string = repo.branch;
    const _path: string = repo.path;
    void _remoteUrl;
    void _branch;
    void _path;
  }
  if (isCredential(cred)) {
    const _provider: string = cred.provider;
    const _value: string = cred.value;
    void _provider;
    void _value;
  }
  if (isNotification(notif)) {
    const _provider: "slack" | "telegram" = notif.provider;
    const _destination: string = notif.destination;
    void _provider;
    void _destination;
  }
  if (isFilesystem(fs)) {
    const _path: string = fs.path;
    void _path;
  }
  assert.ok(true, "compile-time narrowing verified");
});

// Story 09 T1 — buildResource domain extraction

test("buildResource repository: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "repository",
    name: "kanthord",
    remoteUrl: "https://github.com/kanthorlabs/kanthord.git",
    branch: "main",
    path: "/home/dev/kanthord",
    auth: { kind: "ambient" },
  });
  assert.equal(typeof r.id, "string", "id must be a non-empty string");
  assert.ok(r.id.length > 0, "id must be non-empty");
  assert.equal(r.type, "repository");
  assert.equal(r.name, "kanthord");
  if (!isRepository(r)) assert.fail("expected Repository variant");
  assert.equal(r.remoteUrl, "https://github.com/kanthorlabs/kanthord.git");
  assert.equal(r.branch, "main");
  assert.equal(r.path, "/home/dev/kanthord");
});

test("buildResource credential: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "credential",
    name: "openai-key",
    provider: "openai",
    value: "sk-test",
  });
  assert.equal(r.type, "credential");
  assert.equal(r.name, "openai-key");
  if (!isCredential(r)) assert.fail("expected Credential variant");
  assert.equal(r.provider, "openai");
  assert.equal(r.value, "sk-test");
});

test("buildResource notification: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "notification",
    name: "alerts",
    provider: "slack",
    destination: "#general",
  });
  assert.equal(r.type, "notification");
  assert.equal(r.name, "alerts");
  if (!isNotification(r)) assert.fail("expected Notification variant");
  assert.equal(r.provider, "slack");
  assert.equal(r.destination, "#general");
});

test("buildResource filesystem: builds correct variant from valid input", () => {
  const r = buildResource({
    type: "filesystem",
    name: "workspace",
    path: "/workspace",
  });
  assert.equal(r.type, "filesystem");
  assert.equal(r.name, "workspace");
  if (!isFilesystem(r)) assert.fail("expected Filesystem variant");
  assert.equal(r.path, "/workspace");
});

test("buildResource missing required field: throws ResourceValidationError naming the field", () => {
  // repository missing organization
  assert.throws(
    () =>
      buildResource({
        type: "repository",
        name: "test",
        branch: "main",
        path: "/p",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof ResourceValidationError,
        "must throw ResourceValidationError",
      );
      const e = err as ResourceValidationError;
      assert.equal(typeof e.field, "string", "error must carry field name");
      assert.ok(e.field.length > 0, "field name must be non-empty");
      return true;
    },
  );
});

test("buildResource unknown type: throws UnknownResourceTypeError naming the type", () => {
  assert.throws(
    () => buildResource({ type: "magic_wand", name: "test" }),
    (err: unknown) => {
      assert.ok(
        err instanceof UnknownResourceTypeError,
        "must throw UnknownResourceTypeError",
      );
      const e = err as UnknownResourceTypeError;
      assert.equal(
        typeof e.resourceType,
        "string",
        "error must carry the type string",
      );
      assert.equal(e.resourceType, "magic_wand");
      return true;
    },
  );
});

// Story 01 T1 — D2: RepositoryAuth union + EmbeddedCredentialError + new Repository shape

test("EmbeddedCredentialError is thrown when remoteUrl has embedded userinfo", () => {
  assert.throws(
    () =>
      buildResource({
        type: "repository",
        name: "test",
        remoteUrl: "https://x-access-token:sk@github.com/o/r.git",
        branch: "main",
        path: "/repo",
        auth: { kind: "ambient" },
      }),
    (err: unknown) =>
      err instanceof EmbeddedCredentialError && err.field === "remoteUrl",
  );
});

test("buildResource repository: accepts clean remoteUrl and returns Repository with remoteUrl + auth", () => {
  const r = buildResource({
    type: "repository",
    name: "kanthord",
    remoteUrl: "https://github.com/kanthorlabs/kanthord.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
  });
  assert.equal(r.type, "repository");
  if (!isRepository(r)) assert.fail("expected Repository variant");
  assert.equal(r.remoteUrl, "https://github.com/kanthorlabs/kanthord.git");
  assert.deepEqual(r.auth, { kind: "ambient" });
});

test("RepositoryAuth https-token variant carries credentialId and round-trips through isRepository", () => {
  const auth: RepositoryAuth = { kind: "https-token", credentialId: "cred-01" };
  const r = buildResource({
    type: "repository",
    name: "secured",
    remoteUrl: "https://github.com/o/r.git",
    branch: "main",
    path: "/repo",
    auth,
  });
  if (!isRepository(r)) assert.fail("expected Repository variant");
  assert.deepEqual(r.auth, { kind: "https-token", credentialId: "cred-01" });
});

test("RepositoryAuth ssh-agent variant round-trips through isRepository", () => {
  const auth: RepositoryAuth = { kind: "ssh-agent" };
  const r = buildResource({
    type: "repository",
    name: "ssh-repo",
    remoteUrl: "git@github.com:o/r.git",
    branch: "main",
    path: "/repo",
    auth,
  });
  if (!isRepository(r)) assert.fail("expected Repository variant");
  assert.deepEqual(r.auth, { kind: "ssh-agent" });
});

test("Repository type has remoteUrl and auth; organization is absent (compile-time)", () => {
  // Compile-time proof: a Repository assigned without organization must be valid.
  // If organization were still present as required, this annotation would error.
  // The @ts-expect-error below proves organization is NOT on the type:
  // when the SE removes it, accessing r.organization is an error (suppressed);
  // if the SE leaves organization in, the @ts-expect-error itself becomes an error.
  const r: Repository = {
    id: "01H000000000000000000000A9",
    type: "repository",
    name: "test",
    remoteUrl: "https://github.com/o/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
  };
  assert.equal(r.remoteUrl, "https://github.com/o/r.git");
  assert.deepEqual(r.auth, { kind: "ambient" });
  // @ts-expect-error — organization must NOT exist on Repository after D2
  const _org = r.organization;
  void _org;
  assert.ok(true, "Repository compiles without organization field");
});

// ── Story E — endpoint trust controls ──

test("isInsecureEndpoint: plain http:// is insecure", () => {
  assert.equal(isInsecureEndpoint("http://example.com/v1"), true);
});

test("isInsecureEndpoint: http://127.0.0.1 loopback is insecure", () => {
  assert.equal(isInsecureEndpoint("http://127.0.0.1:8080/v1"), true);
});

test("isInsecureEndpoint: http://localhost is insecure", () => {
  assert.equal(isInsecureEndpoint("http://localhost/v1"), true);
});

test("isInsecureEndpoint: http://10.x.x.x private range is insecure", () => {
  assert.equal(isInsecureEndpoint("http://10.0.0.1/v1"), true);
});

test("isInsecureEndpoint: http://192.168.x.x private range is insecure", () => {
  assert.equal(isInsecureEndpoint("http://192.168.1.1/v1"), true);
});

test("isInsecureEndpoint: http://172.16-31.x.x private range is insecure", () => {
  assert.equal(isInsecureEndpoint("http://172.16.0.1/v1"), true);
  assert.equal(isInsecureEndpoint("http://172.31.255.255/v1"), true);
});

test("isInsecureEndpoint: https:// public host is NOT insecure", () => {
  assert.equal(isInsecureEndpoint("https://api.openai.com/v1"), false);
});

test("isInsecureEndpoint: https://127.0.0.1 with loopback host is insecure", () => {
  assert.equal(isInsecureEndpoint("https://127.0.0.1:8080/v1"), true);
});

// Story E, BLOCKER S1: coverage gap — ::1 and 0.0.0.0 loopback hosts
test("isInsecureEndpoint: http://[::1] loopback is insecure", () => {
  assert.equal(isInsecureEndpoint("http://[::1]/v1"), true);
});

test("isInsecureEndpoint: http://0.0.0.0 is insecure", () => {
  assert.equal(isInsecureEndpoint("http://0.0.0.0/v1"), true);
});

// ═══════════════════════════════════════════════════════════════════
// B4 — Bracketed IPv6 loopback (https://[::1] extracts host as "[")
// ═══════════════════════════════════════════════════════════════════

test("isInsecureEndpoint: https://[::1]:8080 bracketed IPv6 loopback is insecure", () => {
  // BUG: current code extracts host as "[" instead of "::1"
  assert.equal(isInsecureEndpoint("https://[::1]:8080/v1"), true);
});

test("isInsecureEndpoint: https://[::1] without port is insecure", () => {
  assert.equal(isInsecureEndpoint("https://[::1]/v1"), true);
});

// ═══════════════════════════════════════════════════════════════════
// S3 — Custom provider default constants
// ═══════════════════════════════════════════════════════════════════

test("CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW is exported and equals 32768", () => {
  assert.equal(CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW, 32768);
});

test("CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS is exported and equals 4096", () => {
  assert.equal(CUSTOM_PROVIDER_DEFAULT_MAX_TOKENS, 4096);
});

// ═══════════════════════════════════════════════════════════════════
// BLOCKER S1 — dead AIProvider code must be removed from resource.ts
// ═══════════════════════════════════════════════════════════════════

test("BLOCKER S1: buildResource rejects ai_provider type with UnknownResourceTypeError", () => {
  // Currently buildResource has an ai_provider branch that succeeds and returns
  // an AIProvider value. After dead-code removal, the ai_provider case must fall
  // through to UnknownResourceTypeError like any other unrecognised type.
  assert.throws(
    () =>
      buildResource({
        type: "ai_provider",
        name: "x",
        provider: "openai",
        model: "gpt-4",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof UnknownResourceTypeError,
        "ai_provider type must throw UnknownResourceTypeError after removal",
      );
      return true;
    },
  );
});

test("BLOCKER S1: isAIProvider is removed (not exported from module)", async () => {
  // Dynamic import to check export existence without static-import crash when removed.
  // Currently isAIProvider IS exported as a function — test fails with
  // "function !== undefined".
  // After removal, mod.isAIProvider is undefined — test passes.
  const mod = await import("./resource.ts");
  assert.equal(
    typeof (mod as Record<string, unknown>).isAIProvider,
    "undefined",
    "isAIProvider must be removed from exports",
  );
});
