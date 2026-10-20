# From a fresh install to the first task

[Tutorials](README.md)

This tutorial starts with the pull of the KanthorD container image and ends with the first task of a mission complete. You follow the Onboarding page of the dashboard. The dashboard leads you through each setup step and returns to Onboarding after each save.

At the end, you have these results:

- KanthorD runs in a container on your host.
- Two agents are enabled: `swe@1` writes the code, and `re@1` reviews it.
- A project binds your GitHub repository and two workers: `coder@1` and `reviewer@1`.
- A plan of one node is imported. `coder@1` pushed a commit to the branch `kanthord/<node_id>` of your repository, and `reviewer@1` passed it. The node is `Completed`.

In KanthorD, a **node** is one unit of work of a mission. A **task** is one step of a node. The plan of this tutorial has one `implement` node with no task file. Such a node is its own single work unit, so "the first task" of this tutorial is that node.

## What you need

- Podman or Docker on the host, and a browser on the same host.
- A GitHub repository that you can administer. Use a test repository: the agent pushes a branch to it. The repository needs a default branch, for example `main`.
- An account at an LLM provider of one of these platforms: `anthropic`, `openrouter`, `openai-compatible`, `openai-codex`, `anthropic-subscription` or `github-copilot`. The dashboard enables an agent only with a credential of these six platforms.
- A free host port for the dashboard, for example `8080`.
- Host port `1455` free: the `podman run` command of guide step 3 publishes it. Only the **Browser** mode of the `openai-codex` sign-in uses it. Without that mode, remove `-p 127.0.0.1:1455:1455` from that command. The `anthropic-subscription` sign-in does not use port 1455.

## The path at a glance

| Step                                                         | Where                     | Result                                                    |
| ------------------------------------------------------------ | ------------------------- | --------------------------------------------------------- |
| [1. Start KanthorD](#1-start-kanthord)                       | Terminal and browser      | The server runs, and the dashboard shows Onboarding.      |
| [2. Read the Onboarding page](#2-read-the-onboarding-page)   | Dashboard `/`             | You know the six setup steps.                             |
| [3. Add the LLM credential](#3-add-the-llm-credential)       | Onboarding step 1         | The server holds the key or the sign-in of the provider.  |
| [4. Enable the agents](#4-enable-the-agents)                 | Onboarding step 2         | `swe@1` and `re@1` are enabled.                           |
| [5. Create the SSH key](#5-create-the-ssh-key)               | Onboarding step 3, GitHub | The repository holds the public key as a deploy key.      |
| [6. Create the project](#6-create-the-project)               | Onboarding step 4         | A project exists.                                         |
| [7. Bind the repository](#7-bind-the-repository)             | Onboarding step 5         | The project binds the repository.                         |
| [8. Bind the workers](#8-bind-the-workers)                   | Onboarding step 6         | The project binds `coder` and `reviewer`.                 |
| [9. Check the readiness panel](#9-check-the-readiness-panel) | Project page              | Every readiness item is `Done`, except **Plan import**.   |
| [10. Import the plan](#10-import-the-plan)                   | Project page, Mission tab | The mission holds one node.                               |
| [11. Watch the first task](#11-watch-the-first-task)         | Project page, GitHub      | The node is `Completed`, and the branch holds the change. |

## 1. Start KanthorD

Do steps 1 to 4 of [Run kanthord in a container](../how-to-guides/run-in-a-container.md):

1. [Get the image](../how-to-guides/run-in-a-container.md#1-get-the-image) with `podman pull`.
2. [Create the configuration](../how-to-guides/run-in-a-container.md#2-create-the-configuration) with `config init`.
3. [Start the server](../how-to-guides/run-in-a-container.md#3-start-the-server) with `podman run`. Set the `GIT_*` values to the author of the agent commits.
4. [Sign in](../how-to-guides/run-in-a-container.md#4-sign-in) with a token from `auth jwt generate`.

To check the start, run `podman logs kanthord`. The record "Gateway Service started" has the level `info`, that is `"level":30`, and the fields `bind` and `port`. In a container, `bind` is `::`.

Do not do steps 5 and 6 of the guide now. The Onboarding page leads you through the same work, in the order that the steps need.

After the sign-in, the dashboard opens `/`. A fresh install has no setup, so `/` shows the **Onboarding** page.

## 2. Read the Onboarding page

The Onboarding page lists six setup steps in a fixed order. Each step shows a badge and one action button:

- `Done`: the setup of the step exists. A credential counts only while it is live, that is, not archived.
- `Next`: the first step that is not done. Do this step now.
- `Open`: a later step that is not done.

| Step                  | Action button                                                                                                  | The step is `Done` when                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. LLM credential     | **New LLM credential**                                                                                         | A live LLM credential exists.                   |
| 2. Enabled agents     | **Enable agents**; **Enable re@1** on a fresh install, until a live LLM credential of an agent platform exists | At least one agent is enabled.                  |
| 3. SSH key            | **Create SSH key**                                                                                             | A live Git credential of platform `ssh` exists. |
| 4. Project            | **New project**                                                                                                | A project exists.                               |
| 5. Repository binding | **Open bindings**, or **New project** while no project exists                                                  | The project holds a repository binding.         |
| 6. Worker bindings    | **Open bindings**, or **New project** while no project exists                                                  | The project holds a worker binding.             |

Each action opens the screen or the sheet of the step. After a successful save, the dashboard returns to `/`. While a step is not done, `/` shows Onboarding. When every step is `Done`, `/` shows **Overview**.

**Skip onboarding** shows Overview in this browser only. The browser keeps the choice until you select **Resume onboarding**. While a step is not done, Overview then shows the link **Resume onboarding**. The link shows Onboarding again.

## 3. Add the LLM credential

The agents call a model with this credential.

1. On step 1, select **New LLM credential**. The **New credential** form opens.
2. Enter a **Name**, for example `claude`. Start with a lowercase letter. Use only lowercase letters, digits and hyphens.
3. Choose the **Platform**. The list has three groups:
   - **Checked before save**: an API key platform. The form can check the key before the create. Of this group, only `anthropic`, `openrouter` and `openai-compatible` serve an agent. `openai` and `opencode-go` do not. A credential of another platform makes step 1 `Done`, but [4. Enable the agents](#4-enable-the-agents) cannot use it.
   - **Sign in with an account**: `openai-codex`, `anthropic-subscription` and `github-copilot`. The server stores the credential when the sign-in completes.
   - **Not checked before save**: the other platforms. An agent cannot use them.

For an API key platform, for example `anthropic`:

1. Paste the key into **API Key**.
2. Select **Verify**. The badge shows `Healthy` for a key that the provider accepts.
3. Select **Create credential**. The dashboard shows "Created claude." and returns to Onboarding. Step 1 is `Done`.

When the badge shows `Unhealthy`, the form shows a hint below it. For a refused key, the hint is "The provider refused the API key or the access token. Correct the key, or sign in again for a new token. Then verify again." **Create credential** then asks "Create the credential with an unhealthy secret?". Select **Keep editing**, correct the key and select **Verify** again. With **Create anyway**, every agent session that uses the credential fails.

For `openai-codex`, select **Start sign-in** and follow [Sign in to OpenAI Codex](../how-to-guides/run-in-a-container.md#6-sign-in-to-openai-codex). When the sign-in completes, the dashboard shows "Signed in. Custody stored <name>." and returns to Onboarding.

For `anthropic-subscription`, the sign-in has one mode: you copy a code from the provider page. It needs no port 1455.

1. Select **Start sign-in**. The sign-in panel shows the address and the field **Paste code**.
2. Select **Open sign-in page**. Sign in to the Anthropic account, then approve the access.
3. The provider page shows a code of the form `code#state`. Copy the whole value.
4. Paste the value into **Paste code**, then select **Send code**.
5. The dashboard shows "Signed in. Custody stored <name>." and returns to Onboarding.

Do steps 1 to 4 within 15 minutes of **Start sign-in**. After 15 minutes, the session expires, and the panel shows **Start again**.

For `github-copilot`, select **Start sign-in** and follow the steps of the sign-in panel. When the sign-in completes, the dashboard shows "Signed in. Custody stored <name>." and returns to Onboarding.

## 4. Enable the agents

`coder@1` uses the agent `swe@1`, and `reviewer@1` uses the agent `re@1`. The server refuses a worker binding whose agent is not enabled, so enable both agents now.

1. On step 2, select **Enable agents**. The page of the LLM credential opens with the sheet **Enable agents with claude**.
2. The sheet lists each agent that is not enabled: `re@1` and `swe@1`. Keep both switches on.
3. **Model identifier** shows the first model of the credential. To use another model, choose it.
4. **Reasoning effort** shows `medium` when the model supports it. Otherwise choose a value. The list holds the effort levels of the model.
5. Select **Enable agents**. The dashboard shows "Enabled re@1 at revision 1. Enabled swe@1 at revision 1." and returns to Onboarding.

The sheet gives each agent an agent provider for the credential and a default configuration with that model and effort. A worker binding uses this default configuration.

When the credential check answers `unhealthy`, **Enable agents** asks "Enable re@1 and swe@1 with an unhealthy credential?". Select **Keep editing** and close the sheet. Select **Rotate secret** on the credential page, then select **Enable agents** again.

Step 2 can show **Enable re@1** or **Enable swe@1** in place of **Enable agents**. Then no live LLM credential has one of the six agent platforms. Before the worker bindings exist, the button names `re@1`, the first agent in name order. It opens the page of the agent, not the sheet. Add a credential of one of those platforms. The other credential can stay. See [What you need](#what-you-need).

## 5. Create the SSH key

The server reads and pushes the repository over SSH. The server creates the SSH key and keeps the private key encrypted. You copy only the public key.

1. On step 3, select **Create SSH key**. The **Git** credentials screen opens with the sheet **Create SSH key**.
2. Enter a **Name**, for example `app`, and select **Create SSH key**.
3. The sheet shows the **Public key** and its **Fingerprint**. Select **Copy**.
4. Add the public key to the GitHub repository as a deploy key with **Allow write access**. [Connect a repository](../how-to-guides/run-in-a-container.md#5-connect-a-repository) shows the GitHub screens.
5. In the dashboard, select **Done**. The dashboard returns to Onboarding.

Add the deploy key before step 7. Without it, the check of the binding answers "The repository host refused the SSH key."

## 6. Create the project

1. On step 4, select **New project**.
2. Enter a **Name**, for example `first`, and select **Create project**.

The dashboard returns to Onboarding. A new project is active: it runs its nodes as soon as they are ready.

## 7. Bind the repository

A repository binding connects the project to the repository under a name. The plan of step 10 names this binding.

1. On step 5, select **Open bindings**. The project page opens on the **Bindings** tab.
2. Select **Add** in the **Repositories** section.
3. Enter a **Name**, for example `app`. Keep the **Platform** `GitHub`.
4. Complete **Address** as `git@github.com:<owner>/<repository>.git`.
5. The sheet pins the host key of `github.com`. Compare the fingerprint as [Connect a repository](../how-to-guides/run-in-a-container.md#5-connect-a-repository) shows.
6. Choose the **SSH credential** of step 5, for example `app`.
7. Keep **Base branch** `main`, or enter the default branch of the repository.
8. Keep **External action** `No external action`.
9. Select **Verify**. Both lines show **Healthy**: **Address · Healthy** and **SSH credential · Healthy**.
10. Select **Save binding**. The dashboard returns to Onboarding.

With `No external action`, a passing review completes the node. The change stays on the node branch, and you merge it yourself.

## 8. Bind the workers

A worker binding turns on one worker for the project. The project needs two: `coder@1` does the work, and `reviewer@1` judges it.

Add the `coder` binding from Onboarding:

1. On step 6, select **Open bindings**. The project page opens on the **Bindings** tab.
2. Select **Add** in the **Workers** section.
3. Enter a **Name**: `coder`.
4. Choose the **Worker** `coder@1`.
5. Wait until the **Agents** section shows `swe@1` with the badge `Enabled`. **Placement** then shows `server`. **Save binding** stays off until the agents load.
6. Keep **Placement** `server` and **Instance count** `1`.
7. Select **Save binding**.

Every Onboarding step is now `Done`, so the dashboard returns to `/` and shows **Overview**. Onboarding counts one worker binding as enough, but the first task needs both. Add the `reviewer` binding now.

Add the `reviewer` binding on the project page:

1. Open **Projects**, then the project `first`, then the **Bindings** tab.
2. Select **Add** in the **Workers** section.
3. Enter the **Name** `reviewer`, and choose the **Worker** `reviewer@1`.
4. Wait until **Placement** shows `server`. Keep **Instance count** `1`.
5. Select **Save binding**. The sheet closes, and the project page stays open.

At the `server` placement, the server runs each instance as a thread. You start no process and generate no token. To run a worker on another host, use the `worker` placement of [Run a worker on another host](../how-to-guides/run-in-a-container.md#8-run-a-worker-on-another-host). To move `coder` or `reviewer` to that placement later, see [Move a server binding to the worker placement](../how-to-guides/run-in-a-container.md#move-a-server-binding-to-the-worker-placement).

Add both bindings before the import. The import refuses a node when no worker binding can claim one of its states. `coder@1` claims a node in `Available`. `reviewer@1` claims it in `Waiting`, and in `External.Requested` after an external action such as a pull request.

## 9. Check the readiness panel

The project page shows the **Readiness** panel above the tabs. Each item shows `Done` or `Open`, and an open item has a link to its fix.

| Item               | `Done` when                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| Repository binding | The project holds a repository binding.                                 |
| Worker bindings    | The project holds a worker binding.                                     |
| Live instances     | Each worker binding with an instance count above 0 has a live instance. |
| Enabled agents     | Every agent of the worker bindings is enabled.                          |
| Plan import        | The mission holds a node.                                               |
| Project active     | The project is not paused.                                              |

Every item is now `Done`, except **Plan import**. The server starts the instances after the save of each binding. When **Live instances** shows `Open`, reload the page after a few seconds.

## 10. Import the plan

A plan file describes one node: what to build, how to judge it and which commands check it.

1. Open the **Mission** tab. The tab shows "The mission holds no nodes."
2. Select **Download a sample plan**. The browser saves `sample-plan.md`.

With exactly one repository binding, the sample names it. Import the file unchanged. With the binding `app`, the file is:

```text
---
intent: implement
depends_on: []
tags: []
bindings:
  - app
verifications:
  - "head -n 1 HEALTH.md | grep -qx 'status: ok'"
---
# Add a HEALTH.md file

## Requirement

Add a file HEALTH.md at the root of the repository that reports the status of the project.

## Criterion

The first line of HEALTH.md is exactly `status: ok`, with no trailing spaces.
```

The verification exits `0` only when the first line of `HEALTH.md` is exactly `status: ok`. At the `server` placement, the worker runs each verification inside the container. The image holds `bash`, `git`, the OpenSSH client and the base Debian tools, for example `head` and `grep`, so the verification runs there.

Import the file:

1. On the **Mission** tab, select **Import**. The sheet **Import mission** opens.
2. In **Plan files**, choose `sample-plan.md`.
3. Enter a **Reason**, for example `First task`. Every node revision records it.
4. Select **Preview**. **Creates** lists `sample-plan.md`, and no violation shows.
5. Select **Apply import**.

The mission graph shows the node **Add a HEALTH.md file** with the intent `implement`. The readiness panel does not refresh after the import. Reload the page. The **Plan import** item then shows "The mission holds 1 node."

An import replaces the whole mission. A later import retires each current node that it does not name by its `id`. A retired node leaves the mission, and a later import cannot name its `id` again. To keep the current nodes and add new ones:

1. On the **Mission** tab, select **Export Markdown**. The browser saves a zip file. Each file in it holds the `id` of its node or task.
2. Unpack the zip file. **Plan files** accepts `.md` files, or one `.json` mission export, not a zip file.
3. Select **Import**. In **Plan files**, choose the exported files and the new plan files together.
4. Enter a **Reason**, then select **Preview**.
5. Check that **Retirements** shows "No node retires." Then select **Apply import**.

## 11. Watch the first task

The node has no dependency, so it is `Available` at once. A worker claims the node in one state, and the node then moves to the state of the work. The Mission Service sets every state, from the claim, the release or the assessment of a worker:

| State        | What happens                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Available`  | The node waits for `coder@1`.                                                                                                       |
| `Executing`  | `coder@1` claimed the node in `Available`. `swe@1` edits the files, and `coder@1` commits and runs the verification.                |
| `Waiting`    | `coder@1` pushed the branch `kanthord/<node_id>` and recorded its head commit. The node waits for `reviewer@1`.                     |
| `Evaluating` | `reviewer@1` claimed the node in `Waiting`. It checks out the commit, runs the verification again, and `re@1` judges the criterion. |
| `Completed`  | The assessment of `reviewer@1` is `success`. With no external action, the Mission Service completes the node.                       |

The **Mission** tab does not refresh by itself. Reload the page to see the current state. Select the node to open its sheet. The **Attempts** tab shows the executions, the assessments and the outcomes of each attempt.

When the node is `Completed`, open the repository on GitHub. The branch `kanthord/<node_id>` holds the commit that adds `HEALTH.md`. Merge it into the base branch yourself, for example with a pull request.

A node can also stop in two other states:

- `Blocked`: the assessment is `undetermined`, or the attempt got its third `criterion-not-met`. The **Attempts** tab shows the rationale of each assessment. Fix the cause, then select **Unblock** on the **Details** tab of the node sheet.
- `Paused`: three executions in a row failed, or three executions in a row ended at their budget with no task done. A provider failure with the code `rate_limited`, `quota_exhausted` or `unavailable` does not count as a failed execution. See [Provider failures](#provider-failures). The **Records** list of each attempt on the **Attempts** tab shows the stop and the **Cause:** of each execution. Fix the cause, then select **Resume** on the **Details** tab of the node sheet.

[How a worker works](../explanation/worker.md#the-life-of-an-implement-node) explains every state and the limits.

### Provider failures

When the provider of the model fails a call, the execution ends with a provider failure. Each attempt on the **Attempts** tab shows the end of its last execution, for example **Last execution ended 2026-10-20 03:28 UTC: Provider failed: unavailable**. The label writes the code in words, for example `rate_limited` as **rate limited**. When the last execution was lost, the line shows its deadline, for example **Last execution ended 2026-10-20 03:28 UTC: lost**. When it ended with no stop, the line is, for example, **Last execution ended 2026-10-20 03:28 UTC: no stop**, with no **Cause:** line. The line **Cause:** below it holds the provider error text, for example `OAuth auth derivation failed for anthropic: Cannot find module '...'` for the code `unavailable`. The worker removes the secrets and cuts the text to 300 characters. The **Records** list of the attempt shows the stop and the cause of each earlier execution. The **Scheduler** page and the **Overview** item of a `Paused` node show the same cause. An error that the agent session throws before the provider answers, for example `No API key found`, is no provider failure. It shows as **Operation failed** with a **Cause:** line.

| Code              | Effect                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `rate_limited`    | Starts a cooldown of the LLM credential. The first cooldown lasts 60 s.   |
| `unavailable`     | Starts a cooldown of the LLM credential. The first cooldown lasts 60 s.   |
| `quota_exhausted` | Starts a cooldown of the LLM credential. The first cooldown lasts 1 hour. |
| `unauthorized`    | Starts no cooldown. The execution counts as a failed execution.           |
| `bad_request`     | Starts no cooldown. The execution counts as a failed execution.           |

A cooldown does not pause the node. The node returns to `Available`, or to `Waiting` for a review. No agent selects a model of the credential until the cooldown ends. The tutorial has one LLM credential, so the node waits for the end of the cooldown.

Each further cooldown of the same credential doubles the duration, up to 24 hours. For `rate_limited`, the durations are 60, 120, 240, 480 and 960 s. The doubling counts every cooldown of the credential, whatever its code. A release with no provider failure on the credential resets the doubling. A `provider_failed` stop with `unauthorized` or `bad_request` neither starts nor resets a cooldown.

An `unauthorized` or `bad_request` failure counts as a failed execution. Three failed executions in a row pause the node. A `rate_limited`, `quota_exhausted` or `unavailable` failure between them does not reset the count. For a refused API key, select **Rotate secret** on the credential page.

The dashboard shows a cooldown in three places:

- The **Cooldown** section of the LLM credential page shows "Strike <n>. Claims skip this credential until <time>." After the end, it shows "No live cooldown. Strike <n> stays until a release without a provider failure." After a clear, or after a release without a provider failure, it shows "No cooldown. Claims can use this credential." The page does not refresh by itself, so reload it to see the current hold.
- The **Details** tab of an `Available` node shows "An agent chain of this project cools down." with each agent whose every model cools down, and the end time.
- While every model of an agent cools down, **Overview** shows "<agent> in <binding> of <project>: every model cools down until <time>." With a project chosen in the project filter, the sentence has no "of <project>".

The dashboard does not clear a cooldown. To list or clear a cooldown, use the CLI with the human token of [guide step 4](../how-to-guides/run-in-a-container.md#4-sign-in):

```sh
podman exec kanthord kanthord agent cooldown list --token '<human token>'
podman exec kanthord kanthord agent cooldown clear <credential name> --token '<human token>'
```

See [Agent cooldowns](../reference/agent/cooldown.md).

## Troubleshooting

| Symptom                                                                                                                                           | Cause and fix                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 2 of Onboarding shows **Enable swe@1** or **Enable re@1**, not **Enable agents**                                                             | No live LLM credential has an agent platform. Create a credential of `anthropic`, `openrouter`, `openai-compatible`, `openai-codex`, `anthropic-subscription` or `github-copilot`.                                                                               |
| The credential page shows "An agent cannot use a credential of platform <platform>."                                                              | The same cause. An agent uses only a credential of the six agent platforms.                                                                                                                                                                                      |
| **Verify** of the repository binding shows "The repository host refused the SSH key."                                                             | The repository does not hold the public key. Add it as a deploy key with write access, as step 5 shows. The [container guide troubleshooting](../how-to-guides/run-in-a-container.md#troubleshooting) lists every other hint.                                    |
| The worker binding sheet shows `swe@1` or `re@1` with the badge `Not enabled` or `Disabled`                                                       | Do step 4, or select **Enable swe@1** or **Enable re@1** in the sheet. The server refuses a worker binding with an agent that is not enabled.                                                                                                                    |
| The preview shows "The node write adds a node and claimable state pair that no worker binding covers."                                            | A state of the node has no worker binding that can claim it. Add the `coder` and the `reviewer` bindings of step 8, then select **Preview** again.                                                                                                               |
| The preview shows "No binding named <name>. Current bindings: …"                                                                                  | The plan names a binding that the project does not hold. Write the name of your repository binding under `bindings`.                                                                                                                                             |
| The node returns to `Available` again and again, then moves to `Blocked` or `Paused`                                                              | A verification fails on every run. At the `server` placement, each verification runs inside the container, and the image holds no Node.js, for example for `npm test`. Use a command that the container can run, as the sample plan of step 10 does.             |
| The **Attempts** tab shows **Provider failed: rate limited**, **quota exhausted** or **unavailable**, and the node stays `Available` or `Waiting` | The LLM credential has a cooldown. The **Cooldown** section of the credential page shows its end time. The node does not pause. It runs again when the cooldown ends. The **Cause:** line names the provider error. See [Provider failures](#provider-failures). |
| The **Attempts** tab shows **Provider failed: unauthorized** or **bad request**                                                                   | The provider refused the call. The **Cause:** line names the refusal. Each such execution counts as a failed execution, and three in a row pause the node. For a refused API key, select **Rotate secret** on the credential page.                               |
| **Live instances** stays `Open`                                                                                                                   | Select **Open workers** on the item. The Workers page shows the instances of the project.                                                                                                                                                                        |

## Read next

- [How a worker works](../explanation/worker.md): the life of a node, the claim, the execution and the review.
- [How the coder@1 worker works](../explanation/coder-worker.md): every step of one execution.
- [Run a worker on another host](../how-to-guides/run-in-a-container.md#8-run-a-worker-on-another-host): the `worker` placement.
- [Import the plan](#10-import-the-plan): a later import must name the current nodes by their `id`, or it retires them.
- Reference: [project bindings](../reference/project/binding.md), [Git credentials](../reference/repository/credential.md), [mission import](../reference/mission/import.md).
