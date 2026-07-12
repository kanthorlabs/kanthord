/**
 * src/broker/verbs/github-http — hermetic tests for makeGithubHttpSeam.
 * Starts a loopback node:http server; no real network under npm test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type {
  CreatePrResponse,
  CreatePrDuplicateResponse,
  GetPrResponse,
  ListPrResponse,
} from "./github-create-pr.ts";
import { makeGithubHttpSeam } from "./github-http.ts";

const TOKEN = "ghp_test_sentinel_abc123";

function startMock(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.resume(); // drain request body so the connection completes
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
    server.on("error", reject);
  });
}

test("createPr maps 201 response to created shape", async () => {
  const { baseUrl, close } = await startMock((_req, res) => {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ number: 42, html_url: "https://github.com/o/r/pull/42" }),
    );
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    const result = await seam.createPr("/repos/o/r/pulls", {}, {
      head: "feat",
      base: "main",
      title: "T",
    });
    const r = result as CreatePrResponse;
    assert.equal(r.status, 201);
    assert.equal(r.number, 42);
    assert.equal(r.url, "https://github.com/o/r/pull/42");
  } finally {
    await close();
  }
});

test("createPr maps 422 already-exists to duplicate shape", async () => {
  const { baseUrl, close } = await startMock((_req, res) => {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        message: "Validation Failed",
        errors: [{ message: "A pull request already exists for o:feat." }],
      }),
    );
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    const result = await seam.createPr("/repos/o/r/pulls", {}, {
      head: "feat",
      base: "main",
      title: "T",
    });
    const r = result as CreatePrDuplicateResponse;
    assert.equal(r.status, 422);
    assert.ok(typeof r.message === "string" && r.message.length > 0);
  } finally {
    await close();
  }
});

test("getPr maps merged PR body to merged state", async () => {
  const { baseUrl, close } = await startMock((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        number: 99,
        state: "closed",
        html_url: "https://github.com/o/r/pull/99",
        merged: true,
      }),
    );
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    const result = await seam.getPr("/repos/o/r/pulls/99", {});
    const r = result as GetPrResponse;
    assert.equal(r.state, "merged");
    assert.equal(r.number, 99);
    assert.equal(r.merged, true);
  } finally {
    await close();
  }
});

test("listByHead returns parsed array of {number, state, url}", async () => {
  const { baseUrl, close } = await startMock((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify([
        { number: 7, state: "open", html_url: "https://github.com/o/r/pull/7" },
      ]),
    );
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    const result = await seam.listByHead(
      "/repos/o/r/pulls?head=o:feat&state=all",
      {},
    );
    const r = result as ListPrResponse;
    assert.equal(r.length, 1);
    assert.equal(r[0]?.number, 7);
    assert.equal(r[0]?.state, "open");
    assert.ok(typeof r[0]?.url === "string" && r[0].url.includes("pull/7"));
  } finally {
    await close();
  }
});

test("requests carry Authorization: Bearer token and Accept header", async () => {
  let capturedAuth: string | undefined;
  let capturedAccept: string | undefined;
  const { baseUrl, close } = await startMock((req, res) => {
    capturedAuth = req.headers["authorization"] as string | undefined;
    capturedAccept = req.headers["accept"] as string | undefined;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([]));
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    await seam.listByHead("/repos/o/r/pulls", {});
    assert.equal(capturedAuth, `Bearer ${TOKEN}`);
    assert.equal(capturedAccept, "application/vnd.github+json");
  } finally {
    await close();
  }
});

test("unexpected status throws error that contains no token", async () => {
  const { baseUrl, close } = await startMock((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Internal Server Error" }));
  });
  try {
    const seam = makeGithubHttpSeam({ baseUrl, token: TOKEN });
    await assert.rejects(
      () => seam.getPr("/repos/o/r/pulls/1", {}),
      (err: Error) => {
        assert.ok(
          !err.message.includes(TOKEN),
          `error message must not contain token; got: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    await close();
  }
});
