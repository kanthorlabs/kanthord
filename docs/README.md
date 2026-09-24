# Kanthord documentation

Kanthord is a work orchestration system for organizing goals, executing steps, and evaluating results. This is its public documentation for users, operators, and API consumers.

Read it online at **[kanthord.kanthorlabs.com](https://kanthord.kanthorlabs.com)**.

## Find what you need

| Question                                       | Documentation                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| What commands and endpoints are available?     | [Feature reference (API and CLI)](reference/README.md)                                                                            |
| How do I create or check server configuration? | [config init](reference/config/init.md), [config validate](reference/config/validate.md), [config show](reference/config/show.md) |
| How do I run the server?                       | [serve](reference/serve.md)                                                                                                       |
| How do I authenticate?                         | [Human JWT generation](reference/jwt.md) and [verification](reference/gateway/verify.md)                                          |
| How do I interpret health reports?             | [Healthchecks explained](explanation/healthchecks.md)                                                                             |
| What do errors and IDs mean?                   | [Errors](reference/errors.md) and [identities](reference/identities.md)                                                           |

## Current scope

The reference describes implemented behavior, not the full proposed product. The server currently exposes Gateway operations and a worker-registration route. Worker registration requires collaborators that the standalone server does not yet supply. Project, Mission, Scheduler, and Tracking CLI groups currently expose help only. `serve server` runs the server; `serve worker` starts a version-checking worker skeleton that hosts no instances yet.

## Documentation types

Public documentation follows [Diátaxis](https://diataxis.fr/):

- **Tutorials** teach through a guided learning experience. Add `tutorials/` when the first tutorial is ready.
- **How-to guides** describe a specific task. Add `how-to-guides/` when the first guide is ready.
- **Reference** organizes implemented features into one page each, with function description, expected response, API shape (including cURL), and CLI shape (including arguments and options).
- **Explanation** develops understanding of behavior, guarantees, and limitations.

Keep each page focused on its reader's question. Internal design discussions and source-level implementation notes are maintained separately and are not part of this site.
