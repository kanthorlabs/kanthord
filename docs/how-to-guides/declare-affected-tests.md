# Declare the affected tests of a repository

[How-to guides](README.md)

Declare one command that selects and runs the tests that a change of the node reaches. KanthorD runs that command for each `implement` node, at the release gate of `coder@1` and at the evaluation of `reviewer@1`. A test that the change breaks then fails the node, also when no verification of the node lists it.

The repository owns the map from changed files to tests, the selection and the test run. KanthorD owns the change set, the run, the verdict, the evidence and the spans. [The affected test run](../explanation/coder-worker.md#the-affected-test-run) explains how KanthorD uses the result.

## Before you start

- A repository binding of a project, with its base branch. See [project bindings](../reference/project/binding.md).
- A test runner that runs a list of test files and reports each failed test.
- A way to map a changed file to the tests that it reaches, for example `vitest related` or an import graph of your own.

## 1. Write the selector command

Write one command that does these steps in the root of the repository:

1. Read the change set from the file that `KANTHORD_CHANGES` names.
2. Select the test files that the change set reaches.
3. Run the selected test files. Run each failed test file once more. Set a limit on the reruns. The KanthorD selectors rerun the failed files only when 8 or fewer files hold a failed test. With more files, they report each failed test in `failed` and an empty `flaky`.
4. Write one JSON report to the path that `KANTHORD_AFFECTED_REPORT` names.
5. When the report lists no failed test, exit with code 0. When it lists one or more, exit with code 1.

Do not exit with code 127 or with a code from 129 to 192. KanthorD reads exit code 127 as an absent command, and it can stop the execution with `command_absent`. KanthorD reads a code from 129 to 192 as a signal end. It runs the command once more. When the rerun also ends with a signal, KanthorD stops the execution with `worker.verification.infrastructure_failed`.

KanthorD runs the command with `bash -c` in the checkout of the repository, at the node head. The command thus runs the selector code of the node head. The environment of the command is the environment of a verification, plus three variables:

| Variable                   | Value                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `KANTHORD_CHANGES`         | The absolute path of the changes file.                                                         |
| `KANTHORD_AFFECTED_REPORT` | The absolute path of the report file. The file does not exist when the command starts.         |
| `KANTHORD_BASE_COMMIT`     | The merge base of `origin/<base_branch>` and the node head. The changes file uses this commit. |

KanthorD writes the changes file in the workspace, outside every checkout. It removes the changes file and the report file after the run.

After a failure at the node head, KanthorD runs the command of the base-branch declaration on the base head, with the same changes file. A path of the changes file can thus be absent from that checkout, for example an added file. The command must accept such a path.

### The changes file

KanthorD computes `files` with `git diff --name-status -z --find-renames <base_commit> <head_commit>`.

```json
{
  "version": 1,
  "binding_id": "binding_01M5SQ3VMP6H1MR49ZHN0EKBDC",
  "repository": "api",
  "base_commit": "f0d09a0cbb8f53f69a21d3163c4bd626b00026cf",
  "head_commit": "88e07e90b2f48caaeebcc7b010b5d6e3f5aed770",
  "files": [
    { "path": "src/server.ts", "status": "modified" },
    {
      "path": "src/health/route.ts",
      "status": "renamed",
      "previous_path": "src/health.ts"
    }
  ]
}
```

| Field         | Value                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `version`     | `1`.                                                                                                                    |
| `binding_id`  | The repository binding of the checkout.                                                                                 |
| `repository`  | The name of the repository binding.                                                                                     |
| `base_commit` | The merge base. It equals `KANTHORD_BASE_COMMIT`.                                                                       |
| `head_commit` | The node head that KanthorD tests.                                                                                      |
| `files`       | One entry for each changed path. `path` is relative to the root of the repository and uses `/`.                         |
| `status`      | `added`, `modified`, `deleted` or `renamed`. A type change is `modified`. A `renamed` entry also holds `previous_path`. |

### The report

```json
{
  "version": 1,
  "selection": "related",
  "reason": null,
  "tests": ["src/health/route.test.ts", "src/server.test.ts"],
  "failed": [
    {
      "file": "src/server.test.ts",
      "name": "server > answers 200 on GET /healthz"
    }
  ],
  "flaky": [],
  "excluded_e2e": ["test/e2e/health.test.ts"]
}
```

| Field          | Value                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `version`      | `1`.                                                                                            |
| `selection`    | `related` for the tests that the change set reaches, `all` for every test, `none` for no test.  |
| `reason`       | A nonblank text of at most 256 bytes for `all`. `null` for `related` and `none`.                |
| `tests`        | Each selected test file, relative to the root of the repository. `none` requires an empty list. |
| `failed`       | The test id of each test that failed.                                                           |
| `flaky`        | The test id of each test that failed and then passed in the second run of its file.             |
| `excluded_e2e` | Each end-to-end test file that the change set reaches and that the selection leaves out.        |

A test id is `{ "file": "<test file>", "name": "<full name>" }`. Join the suite names and the test name with a space, `>` and a space. An example full name is `server > answers 200`. A test file that fails to load gives one id with the file path as its name.

KanthorD checks the report with a strict schema. These rules apply:

- The report holds no other key.
- Each `file` of `failed` and `flaky` is an entry of `tests`.
- `failed` and `flaky` hold no common test id.
- The report holds at most 1 MiB. Each list holds at most 10000 entries. Each text holds at most 1024 bytes.
- The exit code is 0 exactly when `failed` is empty.

An absent report, a report that breaks a rule, or an exit code that does not match `failed` is an invalid report.

When the map from a changed file to its tests is not certain, select every test in the scope of the selector. Set `selection` to `all`, and write the cause in `reason`.

## 2. Write the declaration

Write the file `.kanthord/affected-tests.json` in the root of the repository:

```json
{
  "version": 1,
  "command": "npm run --silent test:affected",
  "time_limit_s": 600,
  "gate_files": ["package.json", "scripts/affected-tests.mjs"]
}
```

| Field          | Value                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`      | Required. `1`.                                                                                                                                                                                                                                         |
| `command`      | Required. The selector command, as one nonblank string.                                                                                                                                                                                                |
| `time_limit_s` | Optional. The time limit of one run of the command in seconds, from 60 to 3600. The default is 600.                                                                                                                                                    |
| `gate_files`   | Optional. The repository paths, with `/`, of the files that the command depends on, for example the selector and the test runner configuration. The default is `[]`. KanthorD compares each path with the change set as an exact string, with no glob. |

The file holds no other key. A file that is not valid JSON, that holds another key or that holds a wrong type is an invalid declaration.

When `.gitignore` ignores `.kanthord/`, add an exception for the file:

```gitignore
!/.kanthord/
/.kanthord/*
!/.kanthord/affected-tests.json
```

## 3. Commit the declaration to the base branch

Merge the declaration into the base branch of the repository binding. The worker reads the file at `origin/<base_branch>`, not at the node head. A node thus cannot change the command that judges it. A declaration on a node branch has no effect until it reaches the base branch.

The worker reads the file at every placement: `server`, `container` and `worker`.

## 4. Check the command outside KanthorD

Write `/tmp/changes.json` in the form of [the changes file](#the-changes-file), with the changes of your branch. Write your base branch in place of `<base_branch>`. This command uses `jq`:

```sh
base=$(git merge-base origin/<base_branch> HEAD)
git diff --name-status --find-renames "$base" HEAD |
  jq -R -s --arg base "$base" --arg head "$(git rev-parse HEAD)" '
    split("\n") | map(select(length > 0) | split("\t") |
      if .[0][0:1] == "R" then {path: .[2], status: "renamed", previous_path: .[1]}
      elif .[0] == "A" then {path: .[1], status: "added"}
      elif .[0] == "D" then {path: .[1], status: "deleted"}
      else {path: .[1], status: "modified"} end)
    | {version: 1, binding_id: "local", repository: "local",
       base_commit: $base, head_commit: $head, files: .}' >/tmp/changes.json
```

Then run the command with the three variables:

```sh
KANTHORD_CHANGES=/tmp/changes.json \
KANTHORD_AFFECTED_REPORT=/tmp/report.json \
KANTHORD_BASE_COMMIT="$base" \
npm run --silent test:affected
echo "exit $?"
```

Check that `/tmp/report.json` exists, that it follows the rules of [the report](#the-report), and that the exit code matches `failed`.

## Result

The next release gate and the next evaluation of each `implement` node of the repository run the command after every verification of the node passes. The work prompt of `coder@1` names the command under `## Affected tests`, and tells `swe@1` not to run it.

When a test fails on the node head, KanthorD runs the command on the base head. When each failed test of the node head also fails on the base head, the verdict is `base_red`, and the node passes. Otherwise the node fails. A flaky test counts as failed only when its file is in the change set.

When the change set of a node changes a gate file, a human merges the pull request of the node, also with the landing `kanthord`. The pull request text names each changed gate file. KanthorD refuses a `merge_push` action of that node. See [`strategy.action.landing`](../reference/project/binding.md).

## Examples

The KanthorD repositories declare their own affected tests:

- [kanthord-engine](https://github.com/kanthorlabs/kanthord-engine/blob/main/scripts/affected-tests.mjs) maps each changed file to its tests through the import graph and runs them with `pnpm --silent run test:files`. Its declaration runs `pnpm --silent run test:affected`.
- [kanthord-apps](https://github.com/kanthorlabs/kanthord-apps/blob/main/scripts/affected-tests.mjs) selects the tests with `vitest related` and runs them with vitest.

Each declaration lists its gate files in `gate_files`:

- kanthord-engine: `.kanthord/affected-tests.json`, `package.json`, `scripts/affected-tests.mjs`, `scripts/affected-reporter.mjs`, `scripts/test-reporter.mjs`, `scripts/test-path.mjs` and `scripts/pi-tools.mjs`.
- kanthord-apps: `.kanthord/affected-tests.json`, `package.json`, `scripts/affected-tests.mjs`, `vite.config.ts` and `test/setup.ts`.

Both scripts compute the change set from `origin/main` and the working tree when `KANTHORD_CHANGES` is not set. They also print the report on standard output.

## Troubleshooting

| Symptom                                                                        | Cause and fix                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The execution stops with `environment_failed` and the code `affected_invalid`. | The declaration is invalid. Or the command gives no valid report on the node head, and writes no valid report on the base head. Fix the file or the selector on the base branch.                      |
| The execution stops with `environment_failed` and the code `affected_timeout`. | The command reaches `time_limit_s` on the node head. Or the command gives no valid report on the node head, and reaches `time_limit_s` on the base head. Raise `time_limit_s`, or select fewer tests. |
| The execution stops with `environment_failed` and the code `command_absent`.   | The command gives no valid report on the node head, and exits with code 127 on the base head. Add the tool to the environment of the repository binding.                                              |
| The work prompt holds no `## Affected tests` section.                          | The base branch holds no declaration, or the declaration is invalid.                                                                                                                                  |
