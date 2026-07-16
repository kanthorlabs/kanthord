// Maintainer-owned Epic 027 E2E environment. The script seeds an isolated
// golden store, boots the real daemon, and exposes its Connect API with the
// built SPA on one authenticated TLS origin.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { applyCompiledPlanMigration, compile } from "../src/compiler/compile.ts";
import { runDaemon } from "../src/daemon/run-loop.ts";
import { createStatusServer } from "../src/daemon/status-server.ts";
import { openStore } from "../src/foundations/sqlite-store.ts";
import { JsonlLog } from "../src/foundations/jsonl.ts";
import { recordReplanProposal } from "../src/replan/proposal.ts";
import { makeRing1HookAdapter } from "../src/ring1/hook-binding.ts";
import { initSchema } from "../src/store/schema.ts";
import { validateBindAddress } from "../src/rpc/auth.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = resolve(process.env.WEB_DIST_DIR || join(ROOT, "clients", "web", "dist"));
const USERNAME = process.env.WEB_E2E_USERNAME || "operator";
const PASSWORD = process.env.WEB_E2E_PASSWORD || "kanthord-e2e";
const requestedPort = Number(readArg("--port") ?? process.env.WEB_E2E_PORT ?? 0);
const childSeparator = process.argv.indexOf("--");
const childCommand = childSeparator === -1 ? [] : process.argv.slice(childSeparator + 1);
const fixtureNow = 1_750_000_000_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

let fixtureRoot;
let store;
let daemon;
let gateway;
let child;
let cleaningUp = false;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function environmentFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PREFLIGHT ENV FAILURE: ${message}`);
  return 2;
}

function makeTlsMaterial(root) {
  const configuredDir = process.env.KANTHOR_TLS_DIR;
  if (configuredDir) {
    return {
      cert: readFileSync(join(configuredDir, "cert.pem")),
      key: readFileSync(join(configuredDir, "key.pem")),
    };
  }

  const tlsDir = join(root, "tls");
  const result = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(tlsDir, "key.pem"),
    "-out", join(tlsDir, "cert.pem"),
    "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`cannot generate test TLS certificate: ${result.stderr.toString().trim()}`);
  }
  return {
    cert: readFileSync(join(tlsDir, "cert.pem")),
    key: readFileSync(join(tlsDir, "key.pem")),
  };
}

async function seedFixture(root, fixtureStore, interactionLog) {
  initSchema(fixtureStore);
  applyCompiledPlanMigration(fixtureStore);

  const featureDir = join(root, "features", "feat-001");
  await mkdir(join(featureDir, "001-alpha"), { recursive: true });
  await mkdir(join(root, "tls"), { recursive: true });
  await Promise.all([
    writeFile(join(featureDir, "epic.md"), "# Golden feature\n"),
    writeFile(join(featureDir, "STATE.md"), "# Golden State\nfeature in progress\n"),
    writeFile(join(featureDir, "JOURNAL.md"), "# Golden Journal\nfirst entry\n"),
    writeFile(join(featureDir, "001-alpha", "T1-done.md"), "# Done task\n"),
    writeFile(join(featureDir, "001-alpha", "T2-pending.md"), "# Pending task\n"),
    writeFile(join(featureDir, "001-alpha", "T3-pending.md"), "# Pending task\n"),
  ]);
  recordReplanProposal(fixtureStore, {
    proposalId: "e2e-replan-feat-001",
    featureId: "feat-001",
    baseGeneration: 1,
    baseCompileHash: "fixture-generation-1",
    createdAt: fixtureNow,
    edits: [{
      path: "001-alpha/T2-pending.md",
      newContent: "# Pending task\nRevised approach for story\n",
    }],
    displayFiles: [{
      path: "001-alpha/T2-pending.md",
      lines: [
        { kind: "ctx", content: "# Pending task" },
        { kind: "add", content: "Revised approach for story" },
      ],
    }],
  });

  for (const suffix of ["desktop", "mobile"]) {
    const signOffFeatureId = `e2e-plan-signoff-${suffix}`;
    const signOffTaskId = `${signOffFeatureId}/001-control/T1-signoff`;
    const signOffFixture = await seedCompiledControlFixture(root, fixtureStore, {
      featureId: signOffFeatureId,
      taskId: signOffTaskId,
      taskStatus: "pending",
      taskDetail: "Initial sign-off plan.",
    });
    await writeFile(
      signOffFixture.taskPath,
      controlTaskPlan(signOffTaskId, "Signed-off plan revision."),
    );

    const haltFeatureId = `e2e-plan-halt-${suffix}`;
    await seedCompiledControlFixture(root, fixtureStore, {
      featureId: haltFeatureId,
      taskId: `${haltFeatureId}/001-control/T1-running`,
      taskStatus: "running",
      taskDetail: "Running task for the halt control.",
    });

    const replanFeatureId = `e2e-plan-replan-${suffix}`;
    const replanFixture = await seedCompiledControlFixture(root, fixtureStore, {
      featureId: replanFeatureId,
      taskId: `${replanFeatureId}/001-control/T1-pending`,
      taskStatus: "pending",
      taskDetail: "Original plan before replan approval.",
    });
    const reopenedTaskId = `${replanFeatureId}/001-control/T1-reopened`;
    const reopenedTaskContent = controlTaskPlan(reopenedTaskId, "Reopened by approved replan.");
    recordReplanProposal(fixtureStore, {
      proposalId: `e2e-plan-replan-${suffix}`,
      featureId: replanFeatureId,
      baseGeneration: 1,
      baseCompileHash: replanFixture.compileHash,
      createdAt: fixtureNow,
      edits: [{ path: replanFixture.relativeTaskPath, newContent: reopenedTaskContent }],
      displayFiles: [{
        path: replanFixture.relativeTaskPath,
        lines: [
          { kind: "ctx", content: "---" },
          { kind: "add", content: `id: ${reopenedTaskId}` },
        ],
      }],
    });
  }

  const storyId = "feat-001/001-alpha";
  const tasks = [
    { id: `${storyId}/T1-done`, status: "done", passed: 1 },
    { id: `${storyId}/T2-pending`, status: "pending", passed: 0 },
    { id: `${storyId}/T3-pending`, status: "pending", passed: 0 },
  ];
  fixtureStore.run(
    "INSERT INTO plan_node (id, kind, feature_id, slug, generation) VALUES (?, ?, ?, ?, ?)",
    "feat-001", "epic", "feat-001", "Golden feature", 1,
  );
  fixtureStore.run(
    "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
    storyId, "story", "feat-001", 1,
  );
  for (const task of tasks) {
    fixtureStore.run(
      "INSERT INTO plan_node (id, kind, feature_id, generation) VALUES (?, ?, ?, ?)",
      task.id, "task", "feat-001", 1,
    );
    fixtureStore.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
      task.id, "feat-001", task.status, task.passed,
    );
  }
  fixtureStore.run(
    "INSERT INTO plan_edge (from_node_id, to_node_id, kind) VALUES (?, ?, ?)",
    tasks[0].id, tasks[1].id, "grammar",
  );
  fixtureStore.run(
    `INSERT INTO broker_in_flight
       (op_id, verb, request_id, idempotency_key, payload_json, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    "op_INFLIGHT00000000000000000", "deploy_service", "req-golden", "idem-golden",
    JSON.stringify({ feature_id: "feat-001" }), "in_flight",
  );
  fixtureStore.run(
    "INSERT INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
    tasks[0].id,
    JSON.stringify([
      { kind: "reservation", reservationId: "golden-cost", conservativeCharge: 11 },
    ]),
  );

  const summaryEvents = [
    ["summary-approval-1", "approval", false],
    ["summary-approval-2", "approval", false],
    ["summary-clarification", "clarification", false],
    ["summary-correction", "correction", false],
    ["summary-excluded", "rework", true],
  ];
  for (const [itemId, category, excluded] of summaryEvents) {
    await interactionLog.append({
      item_id: itemId,
      task_id: tasks[0].id,
      feature_id: "feat-001",
      confirmed_category: category,
      ...(excluded ? { excluded_from_automation_metric: true } : {}),
    });
  }

  const approvalContexts = new Map();
  for (const suffix of ["desktop", "mobile"]) {
    const responseTask = `control-response-${suffix}`;
    const blockedTask = `control-blocked-${suffix}`;
    const approvalTask = `control-github-${suffix}`;
    for (const taskId of [responseTask, blockedTask, approvalTask]) {
      fixtureStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
        taskId, "fixture-control", "blocked", 0,
      );
    }

    insertInbox(fixtureStore, `e2e-approval-loop-${suffix}`, "escalation", {
      type: "text",
      text: "Golden approval evidence",
      task_id: responseTask,
      reason: "budget-breach",
    });

    const blockedPath = "/workspace/src/forbidden/secret.ts";
    let ring1Escalation;
    const hook = makeRing1HookAdapter({
      registry: {
        roles: {
          coding: {
            read: { allow: ["/workspace/**"], deny: [] },
            write: { allow: ["/workspace/src/**"], deny: [] },
          },
        },
      },
      role: "coding",
      writeScope: ["/workspace/src/allowed/**"],
      unknownEffectfulToolNames: new Set(),
      onEscalate: (event) => { ring1Escalation = event; },
    });
    const blocked = await hook({
      assistantMessage: { role: "assistant", content: [] },
      toolCall: { id: `ring1-${suffix}`, name: "write_file", input: { path: blockedPath } },
      args: { path: blockedPath },
      context: { systemPrompt: "web E2E fixture", messages: [], tools: [] },
    });
    if (blocked?.block !== true || ring1Escalation === undefined) {
      throw new Error("golden ring-1 action was not blocked");
    }
    insertInbox(fixtureStore, `e2e-ring1-blocked-${suffix}`, "escalation", {
      task_id: blockedTask,
      reason: "scope-violation",
      payload_summary: `Ring-1 blocked ${blockedPath}`,
    });

    const opId = `op-e2e-github-${suffix}`;
    const entry = {
      verb: "github.merge",
      tier: "approval_required",
      timeout: 60_000,
      idempotency: { window_ms: 3_600_000 },
      retry: { max: 3, backoff: "exponential" },
      poll_interval: 5_000,
      terminal_states: ["done", "failed"],
      rate_limit: { requests_per_minute: 60 },
      observed_state_can_regress: false,
      pending_expiry_ms: 3_600_000,
    };
    const adapter = {
      submit: async () => `request-e2e-github-${suffix}`,
      poll_status: async () => ({ state: "done" }),
      reconcile: async () => ({ outcome: "done" }),
    };
    fixtureStore.run(
      "INSERT INTO broker_pending (op_id, verb, idempotency_key, pending_at, status) VALUES (?, ?, ?, ?, ?)",
      opId, entry.verb, `github.merge:${approvalTask}`, Date.now(), "pending",
    );
    insertInbox(fixtureStore, `e2e-github-merge-${suffix}`, "approval", {
      op_id: opId,
      verb: "github.merge",
      desired_effect: "acme/kanthord#42",
      tier: "approval_required",
    });
    approvalContexts.set(opId, { entry, adapter, payload: { target: "acme/kanthord#42" } });
  }

  return { featureDir, approvalContexts };
}

function controlEpicPlan(featureId) {
  return `---
id: ${featureId}
---
# E2E control fixture

## Acceptance
- Control flow completes.
`;
}

function controlTaskPlan(taskId, detail) {
  return `---
id: ${taskId}
workflow: tdd@1
ticket: WEB-E2E-1
---
# Control task

## Prerequisites
- Fixture store is ready.

## Inputs
- Control request.

## Outputs
- Control result.

## Tests
- Control flow succeeds.

${detail}
`;
}

async function seedCompiledControlFixture(root, fixtureStore, fixture) {
  const featureDir = join(root, "features", fixture.featureId);
  const storyDirName = `001-${fixture.featureId}`;
  const storyDir = join(featureDir, storyDirName);
  const taskPath = join(storyDir, "001-control.md");
  await mkdir(storyDir, { recursive: true });
  await Promise.all([
    writeFile(join(featureDir, "epic.md"), controlEpicPlan(fixture.featureId)),
    writeFile(join(featureDir, "RUNBOOK.md"), "# E2E control runbook\n"),
    writeFile(join(featureDir, "STATE.md"), "# E2E control state\n"),
    writeFile(join(featureDir, "JOURNAL.md"), "# E2E control journal\n"),
    writeFile(join(storyDir, "INDEX.md"), "# E2E control story\n"),
    writeFile(taskPath, controlTaskPlan(fixture.taskId, fixture.taskDetail)),
  ]);
  await compile(featureDir, fixtureStore, {});
  const expectedStoryId = fixture.taskId.slice(0, fixture.taskId.lastIndexOf("/"));
  fixtureStore.run(
    "UPDATE plan_node SET id = ? WHERE id = ? AND feature_id = ? AND kind = 'story'",
    expectedStoryId,
    storyDirName,
    fixture.featureId,
  );
  fixtureStore.run(
    "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed) VALUES (?, ?, ?, ?)",
    fixture.taskId,
    fixture.featureId,
    fixture.taskStatus,
    0,
  );
  const generation = fixtureStore.get(
    "SELECT generation, compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
    fixture.featureId,
  );
  if (generation?.generation !== 1 || typeof generation.compile_hash !== "string") {
    throw new Error(`control fixture ${fixture.featureId} did not compile at generation 1`);
  }
  return {
    featureDir,
    taskPath,
    relativeTaskPath: `${storyDirName}/001-control.md`,
    compileHash: generation.compile_hash,
  };
}

function insertInbox(fixtureStore, id, kind, evidence) {
  fixtureStore.run(
    "INSERT INTO inbox_items (id, kind, status, created_at, evidence) VALUES (?, ?, ?, ?, ?)",
    id, kind, "open", fixtureNow, JSON.stringify(evidence),
  );
}

function isRpcPath(pathname) {
  return pathname.startsWith("/kanthord.v1.DaemonService/");
}

function hasCredentials(req) {
  return req.headers.authorization === `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
}

function proxyRpc(req, res, backendPort) {
  if (!hasCredentials(req)) {
    res.writeHead(401, {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": 'Basic realm="kanthord-e2e"',
    });
    res.end(JSON.stringify({ code: "unauthenticated", message: "invalid or missing credentials" }));
    return;
  }
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", (error) => {
    console.error(`PREFLIGHT proxy failure: ${error.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end("bad gateway");
  });
  req.pipe(upstream);
}

async function serveSpa(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "https://e2e.invalid").pathname);
  } catch {
    res.writeHead(400);
    res.end("bad request");
    return;
  }
  const relative = normalize(pathname).replace(/^([/\\]*\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let absolute = resolve(DIST, relative || "index.html");
  if (absolute !== DIST && !absolute.startsWith(`${DIST}${sep}`)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await readFile(absolute);
    res.writeHead(200, { "content-type": MIME[extname(absolute)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (extname(absolute) !== "") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    absolute = join(DIST, "index.html");
    const data = await readFile(absolute);
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(data);
  }
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("TLS gateway did not return a TCP address"));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function probe(url, options = {}) {
  return new Promise((resolveProbe, reject) => {
    const request = (url.startsWith("https:") ? httpsRequest : httpRequest)(url, {
      method: options.method ?? "GET",
      rejectUnauthorized: false,
      headers: options.headers,
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`readiness probe ${url} returned ${response.statusCode}`));
        } else {
          resolveProbe();
        }
      });
    });
    request.once("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;
  await closeServer(gateway).catch((error) => console.error(`PREFLIGHT gateway cleanup failure: ${error.message}`));
  await daemon?.stop().catch((error) => console.error(`PREFLIGHT daemon cleanup failure: ${error.message}`));
  store?.close();
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
}

async function main() {
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new Error(`invalid E2E port: ${requestedPort}`);
  }
  validateBindAddress("127.0.0.1", "devtest");
  await access(join(DIST, "index.html"));
  fixtureRoot = await mkdtemp(join(tmpdir(), "kanthord-web-e2e-"));
  const interactionLog = new JsonlLog(join(fixtureRoot, "interactions.jsonl"));
  store = openStore(join(fixtureRoot, "fixture.db"), { busyTimeout: 1_000 });
  const { featureDir, approvalContexts } = await seedFixture(fixtureRoot, store, interactionLog);
  const tls = makeTlsMaterial(fixtureRoot);
  const clock = { now: () => fixtureNow, setTimer: () => undefined };
  const logger = { info: () => undefined };
  /** @type {import("../src/rpc/read-surfaces.ts").PublicConfiguration} */
  const publicConfiguration = {
    diffEscalationPolicy: "escalate_all_diffs",
    brokerDeclarations: [{
      verb: "github.create_pr",
      tier: "auto_with_audit",
      timeoutMs: 120_000,
      idempotencyWindowMs: 3_600_000,
      retryMax: 5,
      retryBackoff: "exponential",
      pollIntervalMs: 10_000,
      terminalStates: ["done", "failed", "escalation_needed"],
      requestsPerMinute: 60,
      observedStateCanRegress: true,
      pendingExpiryMs: 300_000,
    }],
  };
  const verbRegistry = [
    { verb: "deploy_service", tier: "auto" },
    { verb: "github.merge", tier: "approval_required", pending_expiry_ms: 3_600_000 },
  ];

  daemon = await runDaemon({
    store,
    featureDir,
    clock,
    logger,
    piSurface: { spawnAgent: () => { throw new Error("web E2E daemon must remain idle"); } },
    statusPort: 0,
    statusServerFactory: ({ store: daemonStore, port }) => createStatusServer({
      store: daemonStore,
      port,
      bind: "127.0.0.1",
      featureDataRoot: join(fixtureRoot, "features"),
      nowMs: fixtureNow,
      verbRegistry,
      publicConfiguration,
      slotRegistry: [{
        name: "slot-alpha",
        repo: "/repos/kanthord",
        strategy: "worktree",
        heldLeases: ["fixture-control"],
        activeSessions: ["session-golden"],
      }],
      getBudgetCeiling: () => 20,
      daemonVersion: "web-e2e",
      uptimeFn: () => 42,
      verifyFn: async () => ({ outcome: "pass", reportJson: '{"checks":[]}' }),
      featureDirFn: (featureId) => join(fixtureRoot, "features", featureId),
      overrideRateLimitFn: () => ({ allowed: true }),
      overrideDayCapFn: () => ({ allowed: true }),
      interactionLog,
      getApprovalContext: (opId) => approvalContexts.get(opId),
      credentials: [{ username: USERNAME, password: PASSWORD }],
    }),
  });

  gateway = createServer(tls, (req, res) => {
    const pathname = new URL(req.url ?? "/", "https://e2e.invalid").pathname;
    if (isRpcPath(pathname)) {
      proxyRpc(req, res, daemon.address.port);
      return;
    }
    void serveSpa(req, res).catch((error) => {
      console.error(`PREFLIGHT static failure: ${error.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end("internal error");
    });
  });
  const publicPort = await listen(gateway, requestedPort);
  const baseUrl = `https://127.0.0.1:${publicPort}`;
  const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
  await probe(`http://127.0.0.1:${daemon.address.port}/healthz`);
  await probe(`${baseUrl}/`);
  await probe(`${baseUrl}/kanthord.v1.DaemonService/ListFeatures`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "connect-protocol-version": "1",
    },
    body: "{}",
  });

  console.log(`WEB_E2E_BASE_URL=${baseUrl}`);
  console.log(`WEB_E2E_PORT=${publicPort}`);
  console.log(`WEB_E2E_DAEMON_PORT=${daemon.address.port}`);
  console.log(`WEB_E2E_USERNAME=${USERNAME}`);
  console.log("WEB_E2E_READY=1");

  if (childCommand.length === 0) return;
  child = spawn(childCommand[0], childCommand.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      WEB_E2E_BASE_URL: baseUrl,
      WEB_E2E_PORT: String(publicPort),
      WEB_E2E_DAEMON_PORT: String(daemon.address.port),
      WEB_E2E_USERNAME: USERNAME,
      WEB_E2E_PASSWORD: PASSWORD,
    },
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  await cleanup();
  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child?.kill(signal);
    void cleanup().finally(() => { process.exitCode = 128; });
  });
}

try {
  await main();
} catch (error) {
  process.exitCode = environmentFailure(error);
  await cleanup();
}
