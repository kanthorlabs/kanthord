# SU1 — S3 surface + client decision (Epic 020 SU1, unblocks Epic 021 Story 001)

Status: **PASS — 8/8** against the live scratch bucket. Date: 2026-07-14.
Probe: `scripts/dev/probes/su1-s3-spike.mjs`.

## Client decision (this file IS the decision record)

- **Chosen client: `@aws-sdk/client-s3` (AWS SDK v3)** — decided by Ulrich
  2026-07-14 over the lighter `aws4fetch` and a raw signed `fetch`. Rationale:
  battle-tested SigV4 + custom-endpoint support, structured typed errors,
  built-in retry/backoff for throttling, list pagination, and native object
  metadata. Trade-off accepted: larger transitive dependency tree.
- **Pinned:** `@aws-sdk/client-s3@^3.1086.0` in `package.json` + lockfile.
- **Epic 021 must wrap it behind a thin internal S3 interface** (the same
  "wrap the volatile dep" posture as fff) so the SDK surface is swappable.

## Provider

- **Cloudflare R2** (endpoint host `…cloudflarestorage.com`). R2 conventions
  that Epic 021 must code for:
  - **`region: "auto"`** (R2 ignores real regions).
  - **`forcePathStyle: true`** works and is what the probe used (safe across
    S3-compatibles; also fine for MinIO/AWS).
  - Credentials from the custody file: `KANTHOR_S3_ENDPOINT / _REGION / _BUCKET /
    _ACCESS_KEY_ID / _SECRET_ACCESS_KEY` (read via the KEY=VALUE custody loader;
    the probe never echoes values and masks the account-id subdomain).

## Capabilities Epic 021 codes against (all verified live)

| Capability | Command | Result |
|---|---|---|
| **put** (under a prefix, digest in metadata) | `PutObjectCommand` + `Metadata:{ "content-sha256": <hex> }` | ok; ETag returned |
| **get** (integrity/verify pass) | `GetObjectCommand` → body + `Metadata["content-sha256"]` | body + metadata digest round-trip exactly |
| **list** (build changed-set) | `ListObjectsV2Command({ Prefix })` | returns the key |
| **soft-delete** (removed local → `trash/`) | `CopyObjectCommand` (CopySource `/<bucket>/<key>`) then `DeleteObjectCommand` original | original gone, trash retained. **Hard delete never issued** except probe cleanup. |
| **conditional put** | `PutObjectCommand({ IfNoneMatch: "*" })` on an existing key | **honored → `PreconditionFailed` / 412** (R2 enforces conditional writes) |

### Integrity: content digest in METADATA, never the ETag (debate finding)

- The uploader's **own SHA-256 lives in object metadata** (`content-sha256`) and
  is the integrity source of truth. Verified: the metadata digest survives the
  put→get round-trip and matches the client-side hash.
- **ETag is NOT trusted as a content hash.** On S3-compatibles a multipart
  upload's ETag is not the object MD5, and R2's ETag semantics differ from AWS.
  Epic 021 must compare the stored `content-sha256` metadata, never the ETag.
- Conditional put (`If-None-Match:*`) is available for "create-if-absent" races
  but is **not** an integrity mechanism — the metadata digest is.

## Error shapes (the SU1 requirement)

Every error is a typed SDK error with `.name` + `.$metadata.httpStatusCode`:

| Case | Observed | Epic 021 handling |
|---|---|---|
| **missing object** | `NoSuchKey` / **404** (also `NotFound` on HEAD) | expected during list/verify — not an error to escalate |
| **auth failure** | `SignatureDoesNotMatch` / **403** (also `InvalidAccessKeyId` / `AccessDenied`) | typed error + **escalate**; must not block concurrent store writes |
| **throttling** | `SlowDown` / **503** (and `429`) | SDK **retries with exponential backoff** by default (`maxAttempts`, default 3); Epic 021 retries with backoff, never blocks the store. **Not force-triggered in this spike** — documented from SDK/R2 behavior. |

Taxonomy note: reuse the Epic 011 SU2 retryable / terminal / escalate split —
throttling = retryable, auth-failure = escalate, missing-object = terminal-benign.

## Verification

- The dep imports cleanly; the probe **round-trips an object on the scratch
  bucket and cleans up** (all probe objects deleted under `kanthord-su1-probe/`).
- No credential value appears in probe output; endpoint account-id masked.
