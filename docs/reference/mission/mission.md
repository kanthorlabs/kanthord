# Read and export a mission

[Reference index](../README.md)

## Function description

One project has exactly one mission. The Project service creates the mission with the project, empty and at mission version `1`. No operation creates or deletes a mission.

A mission is a graph of nodes and edges. An initiative is a root node. An objective belongs to one initiative. A task belongs to one objective. Containment edges and dependency edges relate the nodes.

The mission version increases by one on each accepted plan write. Plan writes include a node create, a content change, a move, a retirement, a rebind and a dependency edit. A write that changes nothing keeps the version. Plan writes require the current version as `expected_mission_version`.

- `mission get` returns the mission of a project. Use it to find the mission ID from a project ID.
- `mission export` returns the current plan as JSON entries or as Markdown plan files. The answer is a payload that `mission import` of the same format accepts. The export excludes retired nodes.

Each Markdown plan file has a YAML front matter and a body:

```markdown
---
id: node_01M4C5J3SAMS4Z4KZD8DQ9GFTB
kind: objective
parent: platform.md
depends_on: []
bindings:
  - main-repository
verifications:
  - pnpm test
---

# Add the login page

## Requirement

The application shows a login form.

## Criterion

A user with valid credentials reaches the dashboard.
```

The front matter holds `id`, `kind`, `parent`, `depends_on`, `bindings` and `verifications`. An initiative has no `parent`. A task has no `depends_on`. `parent` and `depends_on` name plan files, and `bindings` holds binding names.

**Authority:** every authenticated human holds the same authority under the server-owner ruling. Any verified human token reads any mission.

## Expected response

### mission get

The API returns HTTP `200` with the mission:

```json
{
  "id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "project_id": "project_01M4C5J3S9YN8E5S7T2JFNBG0B",
  "version": 1
}
```

| Property     | Type             | Purpose                                        |
| ------------ | ---------------- | ---------------------------------------------- |
| `id`         | `mission_<ulid>` | Mission ID for every mission command.          |
| `project_id` | `project_<ulid>` | Project that owns the mission.                 |
| `version`    | positive integer | Current mission version for optimistic writes. |

The CLI writes the same JSON object as one line to stdout and exits `0`.

### mission export

The API returns HTTP `200`. With `format=json`, the answer holds plan entries:

```json
{
  "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "mission_version": 7,
  "entries": [
    {
      "filename": "login.md",
      "id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
      "kind": "objective",
      "name": "Add the login page",
      "requirement": "The application shows a login form.",
      "criterion": "A user with valid credentials reaches the dashboard.",
      "verifications": ["pnpm test"],
      "bindings": ["main-repository"],
      "parent": "platform.md",
      "depends_on": []
    }
  ]
}
```

With `format=markdown`, the answer holds plan files:

```json
{
  "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "mission_version": 7,
  "files": [
    {
      "filename": "login.md",
      "content": "---\nid: node_01M4C5J3SAMS4Z4KZD8DQ9GFTB\n..."
    }
  ]
}
```

| Property                                     | Type                              | Purpose                                                                  |
| -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `mission_id`                                 | `mission_<ulid>`                  | Exported mission.                                                        |
| `mission_version`                            | positive integer                  | Mission version of the snapshot; use it as the import `mission_version`. |
| `entries[]`                                  | array (JSON format)               | One entry for each current node, sorted by `filename`.                   |
| `entries[].filename`                         | plan file name                    | Name that matches `^[a-z][a-z0-9_-]*\.md$`.                              |
| `entries[].id`                               | `node_<ulid>`                     | Node ID.                                                                 |
| `entries[].kind`                             | `initiative`, `objective`, `task` | Node kind.                                                               |
| `entries[].name`, `requirement`, `criterion` | string                            | Node content text.                                                       |
| `entries[].verifications`                    | array of strings                  | Verification commands; at least one.                                     |
| `entries[].bindings`                         | array of strings                  | Binding names, not binding IDs.                                          |
| `entries[].parent`                           | plan file name                    | Plan file of the parent. Absent for an initiative.                       |
| `entries[].depends_on`                       | array of plan file names          | Sorted dependency targets. Absent for a task.                            |
| `files[]`                                    | array (Markdown format)           | `{ filename, content }` for each current node, sorted by `filename`.     |

The CLI writes the answer to `--out` and writes one JSON line to stdout:

```json
{ "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS", "mission_version": 7 }
```

For Markdown, the CLI writes each `content` to `<out>/<filename>`. For JSON, the CLI writes the complete answer to the `--out` file. Each file has mode `0600`. The CLI does not parse Markdown.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Operation | Meaning                                                                 |
| ----------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Both      | Absent, invalid or expired token, or a machine token.                   |
| `400 gateway.request.validation_failed`   | Both      | A path or query value fails the schema, for example a bad ID or format. |
| `400 gateway.request.unexpected_body`     | Both      | The request has a body.                                                 |
| `404 mission.mission.not_found`           | Both      | No mission exists for the project, or the mission ID is unknown.        |
| `413 mission.export.too_large`            | Export    | The serialized answer exceeds 10 MiB.                                   |
| `504 gateway.invocation.timeout`          | Both      | The operation exceeded 30 seconds.                                      |

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure prints `<code>: request failed (HTTP <status>).`

| CLI code                                                              | Meaning                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `cli.mission.get.invalid_project_id`                                  | `<project-id>` is not a `project_<ulid>` value.                                        |
| `cli.mission.export.invalid_mission_id`                               | `<mission-id>` is not a `mission_<ulid>` value.                                        |
| `cli.mission.export.invalid_format`                                   | `--format` is not `markdown` or `json`.                                                |
| `cli.mission.export.out_not_empty`                                    | For Markdown, `--out` exists and is not an empty directory.                            |
| `cli.mission.get.token_required`, `cli.mission.export.token_required` | No nonblank token resolves.                                                            |
| `cli.mission.get.indeterminate`, `cli.mission.export.indeterminate`   | A transport failure, a timeout or a malformed answer. Run the command again.           |
| `system.files.create_failed`                                          | The CLI cannot create the Markdown `--out` directory.                                  |
| `system.files.publish_failed`                                         | A destination file exists, or the CLI cannot write a file. The CLI overwrites no file. |

## API shape

### mission get

| Item             | Value                                  |
| ---------------- | -------------------------------------- |
| Method and path  | `GET /api/mission/project/:project_id` |
| Operation ID     | `mission.get`                          |
| Access           | `human` (human bearer JWT)             |
| Timeout          | 30 seconds                             |
| Mutation         | No                                     |
| Path parameters  | `project_id`: `project_<ulid>`         |
| Query parameters | None                                   |
| Request body     | None                                   |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i http://127.0.0.1:31415/api/mission/project/project_01M4C5J3S9YN8E5S7T2JFNBG0B \
  -H 'Authorization: Bearer <human-jwt>'
```

### mission export

| Item             | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Method and path  | `GET /api/mission/:mission_id/export`                |
| Operation ID     | `mission.export`                                     |
| Access           | `human` (human bearer JWT)                           |
| Timeout          | 30 seconds                                           |
| Mutation         | No                                                   |
| Path parameters  | `mission_id`: `mission_<ulid>`                       |
| Query parameters | `format`: required, `markdown` or `json`; no default |
| Request body     | None                                                 |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/mission/mission_01M4C5J3SA6W8RBBC92HA9SSDS/export?format=json' \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

### mission get

```text
kanthord mission get <project-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission get project_01M4C5J3S9YN8E5S7T2JFNBG0B
```

| Positional argument | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `<project-id>`      | Required `project_<ulid>` of the project. |

### mission export

```text
kanthord mission export <mission-id> --format <markdown|json> --out <path> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission export mission_01M4C5J3SA6W8RBBC92HA9SSDS --format markdown --out ./plan
```

| Positional argument | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `<mission-id>`      | Required `mission_<ulid>` of the mission. |

| Option                      | Default / resolution | Purpose                                                                                                                    |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--format <markdown\|json>` | Required; no default | Sets the `format` query value.                                                                                             |
| `--out <path>`              | Required; no default | For Markdown, an absent or empty directory. For JSON, an absent file. The CLI creates absent directories with mode `0700`. |

### Shared options

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

The `mission` group declares `--token` and `--endpoint`, and every `mission` subcommand accepts them. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline for these 30-second operations.

For Markdown, the CLI checks `--out` before the request and again before it writes. The CLI accepts an existing directory of any mode that it can write. It never overwrites a file.
