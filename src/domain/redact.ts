// src/domain/redact.ts — EPIC 014 Story 4
// The single shared value-based credential redactor. Extracted from the inline
// closure at src/agent-runner/pi.ts so the repository probe and the provider
// probe redact through the same path.
//
// Contract: pure string replace, no regex. The "no regex, no parse" rule is
// load-bearing — a secret containing regex metacharacters (`.`, `*`, `(`, …)
// must be replaced literally, not interpreted as a pattern. `null`,
// `undefined`, and `""` secrets return the input unchanged (an empty secret
// is a no-op, not a wipe).

export function makeRedactor(
  secret: string | null | undefined,
): (s: string) => string {
  if (!secret) {
    return (s) => s;
  }
  return (s) => s.split(secret).join("***");
}
