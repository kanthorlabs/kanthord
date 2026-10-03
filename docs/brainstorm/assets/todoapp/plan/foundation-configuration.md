---
kind: task
parent: foundation.md
bindings: []
verifications:
  - node --test test/foundation-configuration.test.js
---
# Validate explicit application configuration

## Requirement

Parse and validate runtime configuration once before startup. Supply a safe `.env.example` and document defaults without committing secrets. Keep proxy trust explicit and disallow blanket production trust of arbitrary proxies.

## Criterion

- Tests cover missing required production values, invalid ports, invalid log levels, nonpositive or excessive session lifetimes, malformed origins and invalid database paths.
- Session lifetime accepts 60 through 604800 seconds and defaults to 86400 seconds.
- Production requires an explicit writable persistent database path. Tests use temporary paths, not the example production path.
- No origin is allowed by default. Credentialed CORS is disabled because authentication uses explicit bearer headers, not cookies.
- Proxy trust defaults to false; configured trusted proxy addresses are validated. Configuration failure happens before listening and names the bad setting without disclosing its value when sensitive.
