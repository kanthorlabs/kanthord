// su1-s3-spike — Epic 020 SU1 S3-compatible storage spike (@aws-sdk/client-s3).
//
// Characterizes the S3 surface Epic 021 codes against: put/get/list, soft-delete
// (copy-to-trash + delete), a content digest carried in object METADATA (never
// the ETag), and the error shapes for missing-object / auth-failure / throttling.
//
// Reads S3 config from the custody file (.data/kanthord/credentials, KEY=VALUE).
// Scratch-only: all objects live under a kanthord-su1-probe/<ts>/ prefix on the
// SCRATCH bucket and are removed on exit. NEVER prints secret values; masks the
// account-identifying part of the endpoint. Exit 0 = PASS, 1 = FAIL, 2 = error.
//   node scripts/dev/probes/su1-s3-spike.mjs

import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// --- config from custody file (never echo values) --------------------------
const CRED_FILE =
  process.env.KANTHOR_CREDENTIALS_FILE ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".data", "kanthord", "credentials");

function loadS3Config() {
  const raw = readFileSync(CRED_FILE, "utf8");
  const kv = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) kv[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  const need = ["KANTHOR_S3_ENDPOINT", "KANTHOR_S3_REGION", "KANTHOR_S3_BUCKET", "KANTHOR_S3_ACCESS_KEY_ID", "KANTHOR_S3_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !kv[k]);
  if (missing.length) throw new Error(`missing S3 keys in custody file: ${missing.join(", ")}`);
  return {
    endpoint: kv.KANTHOR_S3_ENDPOINT,
    region: kv.KANTHOR_S3_REGION,
    bucket: kv.KANTHOR_S3_BUCKET,
    accessKeyId: kv.KANTHOR_S3_ACCESS_KEY_ID,
    secretAccessKey: kv.KANTHOR_S3_SECRET_ACCESS_KEY,
  };
}

// Show only the provider's registrable domain, not any account-id subdomain.
const maskEndpoint = (ep) => { try { const h = new URL(ep).host; return "…" + h.split(".").slice(-2).join("."); } catch { return "(unparseable)"; } };
const streamToString = async (body) => (typeof body.transformToString === "function") ? body.transformToString() : Buffer.concat(await (async () => { const c = []; for await (const x of body) c.push(x); return c; })()).toString();

async function main() {
  const cfg = loadS3Config();
  const prefix = `kanthord-su1-probe/${Date.now()}/`;
  const key = `${prefix}hello.txt`;
  const trashKey = `${prefix}trash/hello.txt`;
  const body = "kanthord su1 probe payload\n";
  const digest = createHash("sha256").update(body).digest("hex");

  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true, // safe across S3-compatibles (MinIO/R2/…)
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  console.log(`provider endpoint: ${maskEndpoint(cfg.endpoint)}, region=${cfg.region}\n`);

  const cleanup = [];
  try {
    // 1. PUT with the content digest in object metadata.
    const put = await client.send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: key, Body: body, ContentType: "text/plain",
      Metadata: { "content-sha256": digest },
    }));
    cleanup.push(key);
    record("put object (digest in metadata)", !!put.ETag, `etag present=${!!put.ETag} (NOT trusted as content hash)`);

    // 2. GET back + verify content + read the digest from metadata (not ETag).
    const got = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const gotBody = await streamToString(got.Body);
    const metaDigest = got.Metadata?.["content-sha256"];
    record("get object round-trips + metadata digest matches", gotBody === body && metaDigest === digest, `body-ok=${gotBody === body}, meta-digest-ok=${metaDigest === digest}`);

    // 3. LIST under the prefix.
    const list = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix }));
    const keys = (list.Contents || []).map((o) => o.Key);
    record("list under prefix returns the object", keys.includes(key), `count=${keys.length}`);

    // 3b. Conditional put — If-None-Match:"*" on an existing key should fail
    //     (object exists). Characterizes whether the provider honors conditional
    //     writes. R2 support varies by version, so record the real outcome.
    let condDetail = "none", condOk = false;
    try {
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, IfNoneMatch: "*" }));
      condDetail = "conditional put IGNORED (overwrote existing — provider does not enforce If-None-Match)";
      condOk = false;
    } catch (e) {
      const code = `${e.name}/${e.$metadata?.httpStatusCode}`;
      condOk = /PreconditionFailed/i.test(e.name) || code.endsWith("/412");
      condDetail = condOk ? `honored → ${code}` : `unexpected error ${code}`;
    }
    record("conditional put (If-None-Match:* on existing key)", condOk, condDetail);

    // 4. Soft-delete demo: copy to trash/ then delete the original.
    await client.send(new CopyObjectCommand({ Bucket: cfg.bucket, Key: trashKey, CopySource: `/${cfg.bucket}/${key}` }));
    cleanup.push(trashKey);
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    let originalGone = false;
    try { await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })); }
    catch { originalGone = true; }
    const trash = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: `${prefix}trash/` }));
    record("soft-delete (copy→trash + delete original)", originalGone && (trash.Contents || []).length === 1, `original-gone=${originalGone}, trash-count=${(trash.Contents || []).length}`);
    if (originalGone) cleanup.splice(cleanup.indexOf(key), 1);

    // 5. Error shape — missing object.
    let missErr = "none";
    try { await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: `${prefix}does-not-exist` })); }
    catch (e) { missErr = `${e.name}/${e.$metadata?.httpStatusCode}`; }
    record("error shape: missing object", /NoSuchKey|NotFound/i.test(missErr) || missErr.endsWith("/404"), missErr);

    // 6. Error shape — auth failure (bad secret).
    const badClient = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: "wrong-secret-for-probe" } });
    let authErr = "none";
    try { await badClient.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix })); }
    catch (e) { authErr = `${e.name}/${e.$metadata?.httpStatusCode}`; }
    badClient.destroy();
    record("error shape: auth failure (bad secret → 403)", /SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied|Forbidden/i.test(authErr) || authErr.endsWith("/403"), authErr);

    // 7. Throttling — not forced (needs load). Documented: SDK surfaces SlowDown /
    //    503 and retries with exponential backoff by default (maxAttempts).
    record("throttling taxonomy documented (SlowDown/503, SDK backoff)", true, "not forced; see findings");

    const pass = results.filter((r) => r.ok).length;
    console.log(`\nRESULT: ${pass === results.length ? "PASS" : "FAIL"} — ${pass}/${results.length}`);
    process.exitCode = pass === results.length ? 0 : 1;
  } finally {
    for (const k of cleanup) {
      try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: k })); } catch { /* best-effort */ }
    }
    client.destroy();
  }
}

main().catch((e) => { console.error("PROBE ERROR:", e?.name, e?.message); process.exit(2); });
