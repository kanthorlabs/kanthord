// src/apps/http/server.test.ts — Story 05: startHttpServer loopback bind, close, no leaked signal listeners.
import test from "node:test";
import assert from "node:assert/strict";
import Koa from "koa";
import { startHttpServer } from "./server.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");

function makeLogger() {
  const lines: string[] = [];
  return {
    lines,
    info(message: string, fields?: Record<string, unknown>) {
      lines.push(JSON.stringify({ level: "info", message, ...fields }));
    },
    warn() {},
    error() {},
  };
}

function makeHealthzApp(): Koa {
  const app = new Koa();
  app.use((ctx) => {
    if (ctx.get("authorization") !== AUTH) {
      ctx.status = 401;
      return;
    }
    ctx.status = 200;
    ctx.body = { data: { status: "ok" } };
  });
  return app;
}

test("startHttpServer resolves with a bound port, logs 'listening', and answers a real fetch", async () => {
  const logger = makeLogger();
  const app = makeHealthzApp();
  const started = await startHttpServer(app, { port: 0, logger });
  try {
    assert.ok(started.port > 0);
    const listeningLines = logger.lines
      .map((l) => JSON.parse(l))
      .filter((l) => l.message === "listening");
    assert.equal(listeningLines.length, 1);
    assert.deepEqual(
      { port: listeningLines[0].port, address: listeningLines[0].address },
      { port: started.port, address: "127.0.0.1" },
    );
    const res = await fetch(`http://127.0.0.1:${started.port}/healthz`, {
      headers: { Authorization: AUTH },
    });
    assert.equal(res.status, 200);
  } finally {
    await started.close();
  }
});

test("the returned address equals 127.0.0.1", async () => {
  const logger = makeLogger();
  const app = makeHealthzApp();
  const started = await startHttpServer(app, { port: 0, logger });
  try {
    assert.equal(started.address, "127.0.0.1");
  } finally {
    await started.close();
  }
});

test("close() resolves and a subsequent fetch to the same port rejects", async () => {
  const logger = makeLogger();
  const app = makeHealthzApp();
  const started = await startHttpServer(app, { port: 0, logger });
  const port = started.port;
  await started.close();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
});

test("start + close twice leaves no leaked SIGTERM/SIGINT listeners", async () => {
  const before = {
    sigterm: process.listenerCount("SIGTERM"),
    sigint: process.listenerCount("SIGINT"),
  };
  const logger = makeLogger();
  const s1 = await startHttpServer(makeHealthzApp(), { port: 0, logger });
  await s1.close();
  const s2 = await startHttpServer(makeHealthzApp(), { port: 0, logger });
  await s2.close();
  assert.equal(process.listenerCount("SIGTERM"), before.sigterm);
  assert.equal(process.listenerCount("SIGINT"), before.sigint);
});
