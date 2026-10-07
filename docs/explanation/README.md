# Explanations

[Documentation home](../README.md)

These pages answer “How does this work, and why?” They explain mechanisms and design choices rather than prescribing tasks or defining interfaces.

- [Service architecture](architecture.md): a colored Mermaid diagram of all seven services, their components, ownership, and shared runtime.
- [How healthchecks work](healthchecks.md): interpreting component reports, partial failures, freshness, cancellation, and the limits of diagnostics.
- [How the native agent works](native-agent.md): how KanthorD builds an agent session on pi, the configuration, the prompt layers, the tools, the budget and the current limits.

For exact commands and API contracts, see the [reference](../reference/README.md).
