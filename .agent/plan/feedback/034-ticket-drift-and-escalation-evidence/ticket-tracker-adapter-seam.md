# Feedback — 034 design input: ticket tracker is a per-company adapter

Recorded 2026-07-10 during the agentic-system dimension review (Ulrich +
debate engine). Owning epic: 034 (fold into authoring/debate).

Architecture names Jira as the external source-of-truth (drift hashes,
snapshot at sign-off — §6.1.2, §6.2.7). Ticket snapshot and drift detection
therefore need a tracker seam so the first implementation is not
Jira-hardcoded. Follow the already-decided git-platform pattern: CLI-first,
REST only for gaps, per-identity credentials in the keyring.

Shape: one small adapter contract (fetch ticket content by ref → canonical
text for hashing), Jira as the first implementation. Not a plugin framework.
