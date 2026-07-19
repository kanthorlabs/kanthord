/**
 * LoginProvider use case — validates the project before running OAuth, then
 * persists the returned credential value via AddResource. Hermetic: fakes for
 * the oauth port, resolver, and AddResource.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LoginProvider } from "./login-provider.ts";
import type {
  OAuthLoginProvider,
  OAuthLoginPresenter,
} from "../../oauth/port.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Resource } from "../../domain/resource.ts";
import {
  DuplicateNameError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";

const PROJECT = "01HPROJECT0000000000000000";

const presenter: OAuthLoginPresenter = {
  showAuthUrl: () => {},
  showDeviceCode: () => {},
  progress: () => {},
  promptCode: async () => "",
};

function fakeResolver(kind: string | undefined): ReferenceResolver {
  return { resolveKind: (_id: string) => kind } as unknown as ReferenceResolver;
}

function fakeOAuth(
  loginImpl: (input: {
    providerId: string;
    method: string;
    presenter: OAuthLoginPresenter;
  }) => Promise<string>,
): { calls: number; oauth: OAuthLoginProvider } {
  const state = { calls: 0 };
  const oauth = {
    has: () => true,
    async login(input: {
      providerId: string;
      method: string;
      presenter: OAuthLoginPresenter;
    }) {
      state.calls++;
      return loginImpl(input);
    },
  };
  return {
    get calls() {
      return state.calls;
    },
    oauth,
  };
}

function fakeProjects(
  saved: Resource[],
  existingNames: string[] = [],
): ProjectRepository {
  return {
    resolveResourceByName: (_projectId: string, name: string) =>
      existingNames.includes(name) ? ["dup-id"] : [],
    addResource: (_projectId: string, resource: Resource) => {
      saved.push(resource);
    },
  } as unknown as ProjectRepository;
}

describe("LoginProvider", () => {
  test("happy path: runs OAuth then persists the returned value as a credential", async () => {
    const saved: Resource[] = [];
    const { oauth } = fakeOAuth(async () => '{"type":"oauth","access":"a"}');
    const uc = new LoginProvider({
      oauth,
      projects: fakeProjects(saved),
      resolver: fakeResolver("project"),
    });

    const id = await uc.execute({
      providerId: "openai-codex",
      projectId: PROJECT,
      name: "openai",
      method: "browser",
      presenter,
    });

    assert.equal(saved.length, 1);
    const cred = saved[0]!;
    assert.equal(cred.id, id, "returned id is the persisted resource id");
    assert.deepEqual(cred, {
      id,
      type: "credential",
      name: "openai",
      provider: "openai-codex",
      value: '{"type":"oauth","access":"a"}',
    });
  });

  test("duplicate name: throws before OAuth runs", async () => {
    const saved: Resource[] = [];
    const fake = fakeOAuth(async () => "should-not-run");
    const uc = new LoginProvider({
      oauth: fake.oauth,
      projects: fakeProjects(saved, ["openai"]),
      resolver: fakeResolver("project"),
    });
    await assert.rejects(
      uc.execute({
        providerId: "openai-codex",
        projectId: PROJECT,
        name: "openai",
        method: "browser",
        presenter,
      }),
      DuplicateNameError,
    );
    assert.equal(
      fake.calls,
      0,
      "OAuth flow must not start on a duplicate name",
    );
    assert.equal(saved.length, 0);
  });

  test("unknown project: throws before OAuth runs (B5)", async () => {
    const saved: Resource[] = [];
    const fake = fakeOAuth(async () => "should-not-run");
    const uc = new LoginProvider({
      oauth: fake.oauth,
      projects: fakeProjects(saved),
      resolver: fakeResolver(undefined),
    });

    await assert.rejects(
      uc.execute({
        providerId: "openai-codex",
        projectId: "nope",
        name: "openai",
        method: "browser",
        presenter,
      }),
      UnknownReferenceError,
    );
    assert.equal(fake.calls, 0, "OAuth flow must not start for a bad project");
    assert.equal(saved.length, 0);
  });

  test("reference of wrong type: throws WrongTypeReferenceError before OAuth", async () => {
    const fake = fakeOAuth(async () => "x");
    const uc = new LoginProvider({
      oauth: fake.oauth,
      projects: fakeProjects([]),
      resolver: fakeResolver("initiative"),
    });
    await assert.rejects(
      uc.execute({
        providerId: "openai-codex",
        projectId: PROJECT,
        name: "openai",
        method: "browser",
        presenter,
      }),
      WrongTypeReferenceError,
    );
    assert.equal(fake.calls, 0);
  });
});
