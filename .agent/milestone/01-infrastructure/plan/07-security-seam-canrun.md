# 07 Security Seam (`canRun`)

Goal:             One policy entrypoint — `canRun(tool, args, ctx) →
                  allow | deny` — that tool execution will route through,
                  default-allow with a small literal denylist, so policy lives in
                  one place.

Decision anchors: D4 (default = allow; single machine, observed), B3 (minimal
                  seam: one `canRun`, default-allow + small denylist), §4 Security
                  seam, D9 (real host safety is the Podman sandbox).

ACs:
- `canRun` returns **allow** by default for an ordinary call.
- It returns **deny** for a small set of **literal, obvious** dangerous cases tied
  to a known tool shape — at minimum: a shell tool given `rm -rf /`; a filesystem-
  read tool given a path under `~/.ssh`; the same for `~/.aws` (the §4 examples).
- Given a denylist with a new rule, the matching call **denies** — the rule set is
  the input that changes the decision.

Constraints:
- Exactly one **policy entrypoint** is exported for later tool routing (D4, B3);
  epic 07 cannot prove system-wide uniqueness before tools exist — call-site
  coverage is verified in epic 09. Default-allow + a **small** denylist (§4); no
  policy engine, no per-tool ACL framework.
- `canRun` is a **pure, synchronous decision**: it returns allow/deny and does not
  execute, emit events, or abort (turning deny into `ToolFinished status=denied`
  is epic 09). Sync `allow | deny` matches the minimal-seam decision (D4/B3) — no
  async approval engine in v1. Adding a rule is a data change, not a call-site edit.
- `ctx` is kept **opaque/minimal** here (it exists per §4/B9); the full run
  context shape is defined in epic 09.
- Denylist rules are **per-tool matchers on literal inputs** — this is a
  **developer-footgun guardrail, not a security boundary.** It does not defend
  against obfuscation / glob / symlink / env-expansion / prompt-injection; D9
  (Podman) is the real safety layer. The ACs assert only the listed literal cases.
- Pure in-process TypeScript, no native dep (D2).

Spike?:           none — pure in-process logic (spike gate not tripped).

Verification:     `node:test`: default-allow for an ordinary call; each literal
                  denylist example denies (`rm -rf /`, read under `~/.ssh`, read
                  under `~/.aws`); adding a deny rule denies the matching call with
                  no call-site change.

Dependencies:     01 (workspace). Consumed by 09 (the tool contract routes every
                  invocation through `canRun` and turns deny into `ToolFinished
                  status=denied`; chokepoint coverage is proven there).

Findings out:     none.
