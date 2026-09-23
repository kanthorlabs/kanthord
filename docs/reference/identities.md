# Entity identities

[Reference index](README.md)

Server-generated opaque entity IDs use `<prefix>_<ulid>`.

- The prefix names the entity kind in singular, lower-case ASCII words separated by single underscores. Each kind has one stable prefix; different kinds do not share a prefix.
- The ULID portion has exactly 26 uppercase Crockford Base32 characters. Its first character is `0`–`7`; the remaining characters are `0`–`9`, `A`–`H`, `J`, `K`, `M`, `N`, `P`–`T`, or `V`–`Z`.
- Store and transmit the full prefixed string, including in references, API fields and logs. Do not strip or change the prefix.
- Validation requires the expected entity prefix and a canonical ULID. Bare ULIDs, wrong-kind prefixes, lowercase ULIDs, overflow values and trailing whitespace are invalid entity IDs.

Examples of the rule are `request_<ulid>`, `project_<ulid>` and `mission_<ulid>`. Project and Mission entity creation are not implemented yet.

## Request IDs

Gateway request IDs use `request_<ulid>`, for example `request_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

- An HTTP request may supply `X-Request-Id`. The Gateway preserves a valid request ID and generates a fresh one when the header is absent or invalid. An invalid correlation ID does not reject the operation.
- Validation happens before request logging and dispatch. The response header, handler context and newly produced failure envelope carry the same full ID.
- Client-side input validation also generates a prefixed request ID for its local failure.
- The shared failure schema validates request IDs. Clients treat malformed failure envelopes as indeterminate results.
- An idempotent replay retains the recorded answer, including its original request ID. Its HTTP response header identifies the current request.

## Exceptions

Protocol-defined identities, natural keys and composite keys retain their declared representations. Human usernames and operation names are not generated opaque entity IDs. JWT `jti` values and client-generated `Idempotency-Key` values remain bare canonical ULIDs under their existing contracts. Temporary filesystem names are not entity identities.

A ULID does not establish causal order. Use the owning service's revision or ordering contract when causal order is required.
