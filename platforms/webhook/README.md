# Webhook

A small, self-hosted webhook event log with provider signature verification, platform challenge handling, global cursor scans, and explicit range pruning.

| Operation | Endpoint | Authentication |
| --- | --- | --- |
| Receive | `POST /api/webhook/{platform}/{webhook_id}` | Secret UUIDv4 in the URL plus the platform's native signature. |
| Scan globally | `GET /api/webhook/events` | Standard JWT in `Authorization: Bearer <JWT>`. |
| Prune a range | `DELETE /api/webhook/events?from=event_<ulid>&to=event_<ulid>` | Same JWT; optional `from`, required `to`, inclusive bounds. |

## Documentation

- [Product requirements](docs/PRD.md)
- [API contract](docs/API.md)
- [Vocabulary](docs/PRD.vocabulary.md)
- [Reusable Cloudflare implementation and deployment plan](cloudflare/docs/IMPLEMENTATION.md)

The Cloudflare design uses one Worker and one SQLite-backed Durable Object. Deployers supply their own account, Worker name, hostname, `masterKey`, JWT issuer, and audience. Humans generate standard JWTs with a purpose-specific derived key; there is no user database or token-issuance service.

Webhook keys are derived separately for each platform by default. Optional `WEBHOOK_SIGNING_KEY_GITHUB`, `WEBHOOK_SIGNING_KEY_SLACK`, and `WEBHOOK_SIGNING_KEY_JIRA` environment variables override only their platform's verification key. An omitted override uses derivation; an empty/invalid override fails closed. Verification never retries another key after a mismatch. Native Slack requires its app-issued signing secret in `WEBHOOK_SIGNING_KEY_SLACK`. These overrides never replace the JWT key.

**Status:** design and implementation planning only. Runtime code and deployment scaffolding are not implemented yet. The repository can be cloned independently; no parent repository is required.
