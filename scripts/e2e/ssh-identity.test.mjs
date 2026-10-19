import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addDeployKey,
  createSshKey,
  deleteRunDeployKeys,
  deployKeyTitle,
  pinHostKey,
  runGh,
  sshHostOf,
} from "./ssh-identity.mjs";

const REPOSITORY = "kanthorlabs/kanthord-verify";
const TOKEN = "fake-token";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake e2e";
const FINGERPRINT = `SHA256:${"A".repeat(43)}`;

function fakeGh(answers) {
  const calls = [];
  const gh = (args, token) => {
    calls.push({ args, token });
    return answers.shift() ?? "";
  };
  return { gh, calls };
}

function fakeApi(answers) {
  const calls = [];
  const answer = (method) => (path, body) => {
    calls.push({ method, path, body });
    return Promise.resolve(answers.shift());
  };
  return {
    api: { get: answer("GET"), post: answer("POST"), put: answer("PUT") },
    calls,
  };
}

test("names the deploy key after the run", () => {
  assert.equal(
    deployKeyTitle("ssh-261019-2140"),
    "kanthord-e2e ssh-261019-2140",
  );
});

test("reads the host of an SSH address", () => {
  assert.equal(
    sshHostOf("git@github.com:kanthorlabs/kanthord-verify.git"),
    "github.com",
  );
  assert.throws(() =>
    sshHostOf("https://github.com/kanthorlabs/kanthord-verify.git"),
  );
});

test("creates an SSH key and answers the public key of its newest revision", async () => {
  const { api, calls } = fakeApi([
    {
      name: "github-com-ssh-1",
      platform: "ssh",
      revisions: [
        {
          revision: 1,
          metadata: { public_key: PUBLIC_KEY, fingerprint: FINGERPRINT },
        },
      ],
    },
  ]);
  assert.deepEqual(await createSshKey(api, "github-com-ssh-1"), {
    public_key: PUBLIC_KEY,
    fingerprint: FINGERPRINT,
  });
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/api/repository/credential/ssh/key",
      body: { name: "github-com-ssh-1" },
    },
  ]);
});

test("pins the host key with the fingerprint of a scan", async () => {
  const { api, calls } = fakeApi([
    {
      host: "github.com",
      public_key: "ssh-ed25519 AAAA",
      fingerprint: FINGERPRINT,
      source: "github_meta",
    },
    {
      host: "github.com",
      public_key: "ssh-ed25519 AAAA",
      fingerprint: FINGERPRINT,
      source: "github_meta",
      created_at: 1,
    },
  ]);
  const pin = await pinHostKey(api, "github.com");
  assert.equal(pin.fingerprint, FINGERPRINT);
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/api/repository/host-key/scan",
      body: { host: "github.com" },
    },
    {
      method: "PUT",
      path: "/api/repository/host-key/github.com",
      body: { fingerprint: FINGERPRINT },
    },
  ]);
});

test("adds a write deploy key whose title holds the run, with the token outside the arguments", () => {
  const { gh, calls } = fakeGh(["42\n"]);
  const id = addDeployKey(
    {
      repository: REPOSITORY,
      token: TOKEN,
      run: "ssh-1",
      publicKey: PUBLIC_KEY,
    },
    gh,
  );
  assert.equal(id, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, TOKEN);
  assert.deepEqual(calls[0].args, [
    "api",
    `repos/${REPOSITORY}/keys`,
    "-f",
    "title=kanthord-e2e ssh-1",
    "-f",
    `key=${PUBLIC_KEY}`,
    "-F",
    "read_only=false",
    "--jq",
    ".id",
  ]);
  assert.ok(!calls[0].args.some((arg) => arg.includes(TOKEN)));
});

test("deletes only the deploy keys of its run", () => {
  const listing = [
    { id: 1, title: "kanthord-e2e ssh-1" },
    { id: 2, title: "kanthord-e2e ssh-10" },
    { id: 3, title: "human key" },
    { id: 4, title: "kanthord-e2e ssh-1" },
  ]
    .map((key) => `${key.id}\t${key.title}`)
    .join("\n");
  const { gh, calls } = fakeGh([`${listing}\n`, "", ""]);
  const deleted = deleteRunDeployKeys(
    { repository: REPOSITORY, token: TOKEN, run: "ssh-1" },
    gh,
  );
  assert.deepEqual(deleted, [1, 4]);
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      [
        "api",
        "--paginate",
        `repos/${REPOSITORY}/keys`,
        "--jq",
        ".[] | [.id, .title] | @tsv",
      ],
      ["api", "-X", "DELETE", `repos/${REPOSITORY}/keys/1`],
      ["api", "-X", "DELETE", `repos/${REPOSITORY}/keys/4`],
    ],
  );
  assert.ok(calls.every((call) => call.token === TOKEN));
});

test("deletes nothing when no deploy key holds the run", () => {
  const { gh, calls } = fakeGh(["", ""]);
  assert.deepEqual(
    deleteRunDeployKeys(
      { repository: REPOSITORY, token: TOKEN, run: "ssh-1" },
      gh,
    ),
    [],
  );
  assert.equal(calls.length, 1);
});

test("refuses a deploy key call without a token or with a malformed repository", () => {
  const { gh, calls } = fakeGh([]);
  assert.throws(() =>
    addDeployKey(
      {
        repository: REPOSITORY,
        token: "",
        run: "ssh-1",
        publicKey: PUBLIC_KEY,
      },
      gh,
    ),
  );
  assert.throws(() =>
    deleteRunDeployKeys(
      { repository: "kanthord-verify", token: TOKEN, run: "ssh-1" },
      gh,
    ),
  );
  assert.equal(calls.length, 0);
});

test("passes the token to gh only in its environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "kanthord-gh-"));
  const path = process.env.PATH;
  try {
    const gh = join(directory, "gh");
    writeFileSync(
      gh,
      '#!/bin/sh\nprintf "env=%s\\n" "$GH_TOKEN"\nprintf "arg=%s\\n" "$@"\n',
    );
    chmodSync(gh, 0o755);
    process.env.PATH = `${directory}:${path}`;
    const lines = runGh(["api", `repos/${REPOSITORY}/keys`], TOKEN)
      .trim()
      .split("\n");
    assert.equal(lines[0], `env=${TOKEN}`);
    assert.deepEqual(lines.slice(1), [
      "arg=api",
      `arg=repos/${REPOSITORY}/keys`,
    ]);
    assert.ok(!lines.slice(1).some((line) => line.includes(TOKEN)));
  } finally {
    process.env.PATH = path;
    rmSync(directory, { recursive: true });
  }
});
