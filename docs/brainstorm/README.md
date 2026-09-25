# Internal brainstorming notes

This directory is for kanthord's internal ideation and discussion, **not public documentation or proof of implemented behavior**. It is excluded from the GitHub Pages artifact.

The former top-level design, vocabulary, implementation-ruling, prompt, and handoff documents have been preserved here. Even files named `*.impl.md` belong to this discussion set: their proposals and rulings do not establish what the engine currently implements.

## Reading map

- [Overview](overview.md) and [vocabulary](overview.vocabulary.md)
- [Architecture](architecture.md), [vocabulary](architecture.vocabulary.md), and [implementation proposals](architecture.impl.md)
- [Project Service](project-service.md), [vocabulary](project-service.vocabulary.md), and [implementation proposals](project-service.impl.md)
- [Custody](custody.md), [vocabulary](custody.vocabulary.md), and [implementation proposals](custody.impl.md)
- [Mission Service](mission-service.md) and [vocabulary](mission-service.vocabulary.md)
- [Scheduler Service](scheduler-service.md) and [vocabulary](scheduler-service.vocabulary.md)
- [Intake Service](intake-service.md) and [vocabulary](intake-service.vocabulary.md)
- [Worker Service](worker-service.md), [vocabulary](worker-service.vocabulary.md), and [implementation proposals](worker-service.impl.md)
- [Tracking Service](tracking-service.md), [vocabulary](tracking-service.vocabulary.md), and [implementation proposals](tracking-service.impl.md)
- [Gateway Service](gateway-service.md), [vocabulary](gateway-service.vocabulary.md), and [implementation proposals](gateway-service.impl.md)
- [Open work and handoff](HANDOFF.md)
- [Engine CLI specification](../../engine/docs/cli/README.md): proposed command contracts, with one file per service and one for remaining commands.
- Draft prompts: [base](assets/prompt/base.md), [swe@1](assets/prompt/swe@1.md), [re@1](assets/prompt/re@1.md)

## Turning discussion into documentation

Validate a settled decision against source and tests before describing it as implemented. Publish user-facing behavior in [public documentation](../README.md); document engine mechanisms and technical decisions in [engine implementation notes](../../engine/docs/README.md). Do not make either audience depend on this discussion history.

“Internal” describes the intended audience and publication policy, not access control. These files remain visible to anyone with repository access. Never put secrets here.
