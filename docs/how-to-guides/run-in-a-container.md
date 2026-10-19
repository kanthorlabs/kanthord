# Run kanthord in a container

[How-to guides](README.md)

Run the published kanthord container image with Podman or Docker. The image contains the server, the CLI and the dashboard. The guide ends with a saved repository binding in the dashboard.

## Before you start

- Podman or Docker on the host.
- A browser on the same host.
- A free host port for the dashboard, for example `8080`.
- Host port `1455` free, for the OpenAI Codex sign-in of step 6.
- A GitHub repository that you can administer, for the deploy key of step 5.

Run every command of this guide in a terminal on the host. `podman run` and `podman exec` run the `kanthord`, `sed`, `ls`, `rm` and `chmod` parts inside a container. Inside the container, `~` is `/var/lib/kanthord`, the volume.

The commands use Podman. With Docker, write `docker` in place of `podman` in each command.

Replace each placeholder with your value:

| Placeholder       | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `<version>`       | The image version, for example `28.0.1`, or `latest`.                    |
| `<port>`          | The host port of the dashboard, for example `8080`.                      |
| `<name>`          | The name of the author of the agent commits, for example `Alice Smith`.  |
| `<email>`         | The email of that author, for example `alice@example.com`.               |
| `<your username>` | Your user name in the dashboard, for example `alice`.                    |
| `<owner>`         | The GitHub owner of the repository, for example `acme`.                  |
| `<repository>`    | The GitHub repository name, for example `app`.                           |
| `<project id>`    | The **Identity** value on the project page, for example `project_01M5…`. |
| `<binding name>`  | The name of a worker binding, for example `coder`. See step 8.           |
| `<server URL>`    | The full URL that a worker host uses, for example `https://kd.acme.dev`. |

## 1. Get the image

```sh
podman pull docker.io/kanthorlabs/kanthord:<version>
```

The image is on Docker Hub as `docker.io/kanthorlabs/kanthord`. Each release has a version tag, and `latest` names the newest release.

## 2. Create the configuration

The image holds no configuration, and the server does not start without one. The default configuration also fails in a container: `curl` and the browser get an empty reply. With only `--gateway-bind ::`, a host port other than `31415` gets `403`. The two options below fix both.

Create the configuration once, in a new volume `kanthord`:

```sh
podman run --rm -v kanthord:/var/lib/kanthord docker.io/kanthorlabs/kanthord:<version> config init --gateway-bind :: --gateway-allowed-host localhost:<port> --gateway-allowed-host 127.0.0.1:<port>
```

The command prints `created: /var/lib/kanthord/config/kanthord/kanthord.yaml`. The two options do these things:

- `--gateway-bind ::` makes the server listen on every address inside the container. The default `127.0.0.1` does not receive the traffic of a published port.
- `--gateway-allowed-host` adds a host to the host allowlist. The server refuses every request with a `Host` header outside this list. The default list holds only `127.0.0.1:31415` and `localhost:31415`, so a host port other than `31415` gets `403`.

`config init` does not replace an existing file. See [config init](../reference/config/init.md).

## 3. Start the server

```sh
podman run -d --name kanthord --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 -v kanthord:/var/lib/kanthord -p 127.0.0.1:<port>:31415 -p 127.0.0.1:1455:1455 -e GIT_AUTHOR_NAME="<name>" -e GIT_AUTHOR_EMAIL="<email>" -e GIT_COMMITTER_NAME="<name>" -e GIT_COMMITTER_EMAIL="<email>" docker.io/kanthorlabs/kanthord:<version>
```

- `--cap-drop=ALL` removes every Linux capability. `--security-opt=no-new-privileges` stops a process from gaining privileges. The server runs as the user `kanthord` and needs neither.
- `--ulimit core=0` stops core dumps. A crash of the server then writes no copy of its memory to disk. The memory can hold the plaintext SSH key of a git operation.
- `-p 127.0.0.1:<port>:31415` publishes the dashboard and the API on the host loopback address only.
- `-p 127.0.0.1:1455:1455` publishes the OpenAI Codex sign-in callback. See step 6.
- The `GIT_*` variables set the identity of the commits that the agents make. Without them, a commit has the author `kanthord <kanthord@localhost>`. To change them later, remove the container with `podman rm -f kanthord`, then run this command again. The volume keeps the data.

Check the server:

```sh
curl http://localhost:<port>/api/liveness
```

A running server answers HTTP `200` with a JSON service map that starts with `{"status":"ok"`. See [liveness](../reference/gateway/liveness.md).

The image also declares a container healthcheck. Every 30 s, Podman or Docker runs `kanthord gateway liveness` inside the container. That command sends no token. Podman runs the first check at the start of the container. That check can fail, because the server is not ready yet. Read the health status:

```sh
podman inspect --format '{{.State.Health.Status}}' kanthord
```

- `starting`: no check passed yet, and fewer than three checks in a row failed after the start period. The start period is the first 30 s after the start. A failed check in this period does not count.
- `healthy`: a check passed, and fewer than three checks in a row failed after it. The first pass comes about 30 s after the start.
- `unhealthy`: three checks in a row failed after the start period. A check that takes more than 5 s fails. With Podman, a server that never passes a check becomes `unhealthy` about 90 s after the start: the checks at about 30 s, 60 s and 90 s fail.

An `unhealthy` status does not stop or restart the container.

To see the check output of the last five checks, run `podman inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' kanthord`.

The check also reads the client file `cli.yaml` of the volume, if the file exists. See [Troubleshooting](#troubleshooting).

The check runs inside the container, so `healthy` does not prove that the published port works. A server that listens on `127.0.0.1`, or a host port that is not in `gateway.allowed_hosts`, also reports `healthy`. Use the `curl` command above for the published port.

The volume keeps the configuration and the database. `podman restart kanthord` keeps both.

## 4. Sign in

Get a human token:

```sh
podman exec -it kanthord kanthord auth jwt generate <your username>
```

The command prints `token: <jwt>`. It prints a token only to a terminal, so keep the `-t` option.

1. Open `http://localhost:<port>/`.
2. Keep the Endpoint value. The dashboard fills it with the address of the page.
3. Paste the token into **JWT token**, then select **Login**.

See [auth jwt generate](../reference/auth/jwt.md).

## 5. Connect a repository

The server reads and pushes a repository over SSH. The server creates the SSH key and keeps the private key encrypted in its database. You copy only the public key. The server writes no file under `~/.ssh` and reads none.

Create the SSH key in the dashboard:

1. Open **Credentials**, then **Git**, then **Create SSH key**.
2. Enter a **Name**, for example `app`. Start with a lowercase letter. Use only lowercase letters, digits and hyphens. Select **Create SSH key**.
3. The sheet shows the **Public key** and its **Fingerprint**. Select **Copy** to copy the public key. Then select **Done**.

The new SSH key is an SSH credential with that name.

Add the public key to GitHub as a deploy key:

1. In the repository, open **Settings**, then **Deploy keys**, then **Add deploy key**.
2. Enter a **Title**, for example `kanthord-app`. Paste the key, and select **Allow write access**. Then select **Add key**.

One deploy key serves one repository. GitHub refuses a deploy key that another repository holds already, so create one SSH key for each repository. Do not add the key as an account SSH key. An account SSH key gives the server write access to every repository of the account.

Then, in the dashboard:

1. Open **Projects**, then **New project**. Enter a name, then select **Create project**.
2. Open the **Bindings** tab. Select **Add** in the **Repositories** section.
3. Enter a binding name in **Name**. Keep the **Platform** `GitHub`.
4. The **Address** field starts with `git@github.com:`. Complete it as `git@github.com:<owner>/<repository>.git`.
5. The sheet reads the host key of `github.com` from `api.github.com` and pins it. The row **Host key of github.com** shows **Pinned** and the fingerprint. On the first pin, it also shows "Host key pinned from api.github.com".
6. Choose the SSH credential that you created, for example `app`.
7. Keep **Base branch** `main`, or enter the default branch of the repository.
8. Select **Verify**. Both lines show **Healthy**: **Address · Healthy** and **SSH credential · Healthy**.
9. Select **Save binding**.

The pin is the host key that the server trusts for `github.com`. Every binding with the host `github.com` uses it. To compare it, open the [SSH key fingerprints of GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). The pinned value equals the `ED25519` value. If the values differ, do not save the binding. Select **Pin again** in the **Host keys** panel, and compare again. **Credentials**, then **Git**, then the **Host keys** panel lists each pin.

### Move from the earlier SSH setup

An earlier version of this guide created the key with `ssh-keygen` in `/var/lib/kanthord/.ssh`. That setup used the alias `github` and the address `git@github:<owner>/<repository>.git`. The server now accepts only `github.com` and `ssh.github.com` as GitHub hosts. The credential `github` holds no key that the server generated. **Verify** on the binding row of the **Bindings** tab shows **Address · Unhealthy** and **SSH credential · Unhealthy**.

First run a newer image with [Use a newer image](#use-a-newer-image). Then do these steps in the dashboard:

1. Open **Credentials**, then **Git**. On the row of the credential `github`, select **Rotate key**. In the dialog, select **Rotate key** again.
2. The dialog shows the new public key. Select **Copy**. Then select **Done**.
3. Add the new public key to the repository as a deploy key with write access, as above.
4. Open the project, then the **Bindings** tab. Select **Edit** on the repository binding.
5. Change the address to `git@github.com:<owner>/<repository>.git`. The sheet pins the host key of `github.com`.
6. Select **Verify**. Both lines show **Healthy**. Select **Save binding**.
7. At GitHub, delete the old deploy key of the repository. Keep the key whose fingerprint equals the **Fingerprint** that the dialog of step 2 shows.

Repeat steps 1 to 7 for each SSH credential and repository binding of the earlier setup, for example `github-lib`. If you added the old key as an account SSH key, delete it in the SSH key settings of the account.

The rotation makes a new revision of the credential. The binding keeps the credential name, so the binding needs no other change. If step 3 is not done, the **Verify** of step 6 shows **Address · Unhealthy** with the hint "The repository host refused the SSH key."

The old files stay in the volume. The server ignores them, but an agent tool process of the server can still read them. Remove them:

```sh
podman exec kanthord rm -r /var/lib/kanthord/.ssh
```

On a worker host of step 8, remove the copy of `kanthord_github` and the `Host github` block of `~/.ssh/config`.

## 6. Sign in to OpenAI Codex

1. Open **Credentials**, then **LLM**, then **New credential**.
2. Enter a **Name**, for example `codex`.
3. Choose the platform `openai-codex`, then select **Start sign-in**.
4. Select **Open sign-in page**, and sign in at the provider.
5. The dashboard shows "Signed in. Custody stored codex." when the sign-in completes.

In the **Browser** mode, the provider sends the browser back to `http://localhost:1455/auth/callback`. The published port 1455 carries that callback into the container.

- The provider fixes port 1455, so you cannot publish the callback on another host port.
- The Codex CLI uses the same port for its own sign-in. While the container runs, a Codex CLI sign-in on the same host fails. While a Codex CLI sign-in runs, the container start fails.
- The **Browser** mode works only for a browser on the container host.

When the callback page does not load, copy the address of that page. In the sign-in panel of the dashboard, select **The callback failed?**. Paste the address into **Code or Redirect URL**, then select **Send code**.

When port 1455 is not free, or the browser is on another machine, choose **Headless (device code)**. That mode needs no port 1455. To free the port, remove the container with `podman rm -f kanthord`. Then run the command of step 3 again without `-p 127.0.0.1:1455:1455`.

## 7. Change the configuration

No command edits an existing configuration file, and the image has no text editor. Edit the file with `sed` in a one-off container.

This example adds the host `kanthord.example.com` to the host allowlist. The expression adds a line below the line `  allowed_hosts:` of the file:

```sh
podman run --rm -v kanthord:/var/lib/kanthord --entrypoint sed docker.io/kanthorlabs/kanthord:<version> -i 's/^  allowed_hosts:$/&\n    - kanthord.example.com/' /var/lib/kanthord/config/kanthord/kanthord.yaml
podman run --rm -v kanthord:/var/lib/kanthord docker.io/kanthorlabs/kanthord:<version> config validate
podman restart kanthord
```

`config validate` prints `valid: /var/lib/kanthord/config/kanthord/kanthord.yaml`. The server reads the file only at its start, so restart it. To see the result, run `podman run --rm -v kanthord:/var/lib/kanthord docker.io/kanthorlabs/kanthord:<version> config show`.

This example sets `gateway.bind` to `::` in an existing volume:

```sh
podman run --rm -v kanthord:/var/lib/kanthord --entrypoint sed docker.io/kanthorlabs/kanthord:<version> -i 's/^  bind: .*/  bind: "::"/' /var/lib/kanthord/config/kanthord/kanthord.yaml
```

Then run `config validate` and `podman restart kanthord` as above.

The file must keep mode `0600`. `sed -i` keeps the mode. Check it with this command:

```sh
podman run --rm -v kanthord:/var/lib/kanthord --entrypoint ls docker.io/kanthorlabs/kanthord:<version> -l /var/lib/kanthord/config/kanthord/kanthord.yaml
```

The line starts with `-rw-------`. See [config validate](../reference/config/validate.md) and [config show](../reference/config/show.md).

## 8. Run a worker on another host

A worker binding with the placement `worker` runs its instances on a worker host, not in the container. Create the worker binding first:

1. In the project, open the **Bindings** tab. Select **Add** in the **Workers** section.
2. Enter a **Name**, for example `coder`.
3. Choose the **Worker**, for example `coder@1`.
4. Keep the **Placement** `worker`.
5. Select **Save binding**.

`<binding name>` is the name of this worker binding, not the name of the repository binding of step 5.

The worker host needs these items:

- `bash`, `git` 2.40 or later, and the OpenSSH 9.0 or later client programs `ssh`, `ssh-agent` and `ssh-add`. `kanthord serve worker` checks them at its start. A missing program stops the start with `repository.connector.tool_missing`. A program below its minimum version stops the start with `repository.connector.tool_version`.
- The `kanthord` binary of the same version as the image. Download `kanthord-<target>` and `SHA256SUMS` from the [releases page](https://github.com/kanthorlabs/kanthord/releases). `<target>` is `darwin-arm64`, `linux-x64` or `linux-arm64`. For the install steps, see [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md#1-install-the-binary) or [Run kanthord on a VPS](run-on-a-vps.md#1-install-the-binary). A Linux worker host of the same architecture as the container can also use the binary of the image: `podman cp kanthord:/usr/local/bin/kanthord .`.
- No SSH key and no `~/.ssh` file. For each execution, the server hands the worker the SSH key of each repository binding and the pinned host key. The worker keeps the private key in memory only and writes it to no file. Run `kanthord serve worker` as a user with no `~/.ssh`. An agent tool process runs as that user and can read its SSH keys.
- Core dumps off for `kanthord serve worker`, for example `ulimit -c 0` in its shell or `LimitCORE=0` in its systemd unit. Its memory holds the plaintext SSH key of each execution.
- A network path to the repository host, `github.com` on port 22. The **Verify** of step 5 runs on the server, so it does not prove this path.
- A temporary directory path of 75 bytes or fewer that holds only letters, digits, `/`, `.`, `_` and `-`. The worker reads `TMPDIR`, else `TMP` or `TEMP`, else it uses `/tmp`. For each git operation, the worker makes an SSH agent socket in that directory. The socket path adds 25 bytes, and its limit is 100 bytes. A longer path or another character fails every SSH operation with `repository.connector.ssh_agent_failed`.
- A network path to the server. The container publishes the server on the host loopback address only. See [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md) or [Run kanthord on a VPS](run-on-a-vps.md). In those guides, write `<port>` in place of `31415` for the proxy target. Add the host part of `<server URL>` to the host allowlist with step 7, for example `kd.acme.dev`.
- The `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` variables in the environment of `kanthord serve worker`. Without them, a commit has the author `kanthord <kanthord@localhost>`.
- A machine token for the worker binding.

The copy of the machine token is a secret. Make a private directory for it on the container host:

```sh
mkdir -m 700 kanthord-transfer
cd kanthord-transfer
```

Create the machine token file in the container, copy it to the host, then remove it from the volume:

```sh
podman exec kanthord kanthord auth jwt generate --project <project id> --binding <binding name> --endpoint <server URL> --output /var/lib/kanthord/<binding name>.cli.yaml
podman cp kanthord:/var/lib/kanthord/<binding name>.cli.yaml .
podman exec kanthord rm /var/lib/kanthord/<binding name>.cli.yaml
```

The first command prints `created: <path>`. It needs no terminal, because it prints no token. The file holds `endpoint`, `token` and `client_secret`. The command refuses to replace an existing file with `system.files.publish_failed`, so remove the copy in the volume.

On the worker host, put the file at `~/.config/kanthord/cli.yaml` with mode `0600`. When `XDG_CONFIG_HOME` is set, the path is `$XDG_CONFIG_HOME/kanthord/cli.yaml`. Then run `kanthord serve worker`.

After the transfer, remove the copy from the container host:

```sh
rm <binding name>.cli.yaml
cd ..
rmdir kanthord-transfer
```

See [serve](../reference/serve.md) and [auth jwt generate](../reference/auth/jwt.md).

## Use a newer image

`podman restart kanthord` keeps the old image. To run a newer image on the same volume, write the new version in place of `<new version>`:

```sh
podman pull docker.io/kanthorlabs/kanthord:<new version>
podman stop kanthord
podman run --rm -v kanthord:/var/lib/kanthord docker.io/kanthorlabs/kanthord:<new version> upgrade
podman rm kanthord
```

Then run the command of step 3 again, with `<new version>` in place of `<version>` and the same `GIT_*` values. See [upgrade](../reference/upgrade.md).

## Troubleshooting

| Symptom                                                                                                                                                                                           | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The container stops at once, and `podman logs kanthord` shows `system.config.not_found`                                                                                                           | The volume holds no configuration. Run step 2, then run `podman start kanthord`. The message names the command `kanthord config init` for a host install. In a container, use the `podman run` form of step 2.                                                                                                                                                                                                                                                                                                                          |
| `curl` fails with `(52) Empty reply from server`, `(56) Connection reset by peer` or `(7) Failed to connect`                                                                                      | The server listens on `127.0.0.1` inside the container. `podman logs kanthord` shows the start record with `"bind":"127.0.0.1"` and the message "Gateway Service started. A loopback bind accepts connections from this host only." Create the configuration with `--gateway-bind ::`. In an existing volume, use the `gateway.bind` example of step 7.                                                                                                                                                                                 |
| `403` with `gateway.http.host_not_allowed`, "Host is not allowed. Add it to gateway.allowed_hosts."                                                                                               | The `Host` header of the request is not in `gateway.allowed_hosts`. The JSON body of the answer holds that header in lower case at `error.details.host`, for example `localhost:8080`. Add that exact value with step 7, with its port when it has one. The answer does not list the allowed hosts. `config init` does not replace an existing file.                                                                                                                                                                                    |
| The health status is `unhealthy`, and the check output shows `gateway.routing.not_found` and `status: 404`                                                                                        | The configuration sets `gateway.base_path`, for example `/s/kanthord`. The check reads `http://127.0.0.1:31415` with no base path. Remove the container with `podman rm -f kanthord`. Run the command of step 3 again, and add `-e KANTHORD_ENDPOINT=http://127.0.0.1:31415/s/kanthord` before the image name. Use your base path in that value.                                                                                                                                                                                        |
| The health status is `unhealthy`, the `curl` command of step 3 answers `200`, and the check output shows `cli.config.invalid`, `system.config.invalid_yaml` or `system.files.invalid_permissions` | The check reads the client file `/var/lib/kanthord/config/kanthord/cli.yaml` before its request. An invalid file, a mode other than `0600`, a symlink or an owner other than the user `kanthord` fails the check while the server answers `200`. For invalid content, correct the file, or remove it with `podman exec kanthord rm /var/lib/kanthord/config/kanthord/cli.yaml`. For a wrong mode, run `podman exec kanthord chmod 0600 /var/lib/kanthord/config/kanthord/cli.yaml`. For a symlink or a wrong owner, remove the file.    |
| The health status is `unhealthy`, and the check output shows `cli.gateway.liveness.indeterminate`                                                                                                 | The check got no HTTP answer. An `endpoint` in `/var/lib/kanthord/config/kanthord/cli.yaml` or a `KANTHORD_ENDPOINT` value must reach the server from inside the container. For a `gateway.port` other than `31415`, add `-e KANTHORD_ENDPOINT=http://127.0.0.1:<gateway port>` to the command of step 3, and add `127.0.0.1:<gateway port>` to `gateway.allowed_hosts`.                                                                                                                                                                |
| `cli.output.terminal_required`                                                                                                                                                                    | `auth jwt generate` prints a token only to a terminal. Add `-t` to `podman exec`, as step 4 shows.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Verify** shows **Address · Unhealthy** and the hint "Open the binding. The sheet pins the host key, or shows Confirm host key." (`host_key_unknown`)                                            | The server holds no pinned host key for the address host. Open the binding with **Edit**. For `github.com`, the sheet pins the key. For another host, compare the fingerprint with the published one of the provider, then select **Confirm host key**. **Save binding** stays off until the host key is pinned.                                                                                                                                                                                                                        |
| **Verify** shows **Address · Unhealthy** and the hint "The host presented another key." (`host_key_changed`)                                                                                      | The host presented a key other than the pinned key. The provider rotated its host key, or a network device intercepts the connection. Open **Credentials**, then **Git**. In the **Host keys** panel, select **Pin again** on the host. For `github.com` and `ssh.github.com`, the dashboard pins the key from `api.github.com`. For another host, a dialog shows the scanned and the pinned fingerprint. Compare the scanned fingerprint with the published one of the provider. Select **Confirm host key** only when they are equal. |
| **Verify** shows **Address · Unhealthy** and the hint "The repository host refused the SSH key." (`key_refused`)                                                                                  | The repository does not hold the public key of the SSH credential. The binding sheet shows that public key below the hint. Add it as a deploy key with write access, as step 5 shows. After a **Rotate key**, add the new public key.                                                                                                                                                                                                                                                                                                   |
| **Verify** shows **Address · Unhealthy** and the hint "The repository host does not find the repository." (`repository_not_found`)                                                                | The owner or the name in the address is wrong, or the deploy key belongs to another repository. Correct the address, or add the key to this repository.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Verify** shows **Address · Unhealthy** and the hint "The server cannot reach the repository host." (`host_unreachable`)                                                                         | The server has no network path to the repository host on port 22. Check the DNS and the outbound port 22 of the container host.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Verify** shows **Address · Unhealthy** and the hint "The check failed for an unknown cause, or it exceeded its deadline." (`unclassified`)                                                      | Select **Verify** again. If the failure stays, read `podman logs kanthord`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The binding sheet shows "The host key of github.com was not read." and **Save binding** stays off                                                                                                 | The server cannot reach `api.github.com` over HTTPS. Check the network of the container host, then select **Retry**.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Verify** shows **Address · Unhealthy** and the hint "The address is not valid, or its host is not a host of the platform." (`address_invalid`)                                                  | The address does not have the form `git@<host>:<owner>/<repository>.git`, or its host is not `github.com` or `ssh.github.com` for GitHub. An address with the alias `github` of the earlier guide gets this result. In the binding sheet, the **Address** field also shows the host rule. See [Move from the earlier SSH setup](#move-from-the-earlier-ssh-setup).                                                                                                                                                                      |
| **Verify** shows **SSH credential · Unhealthy** or **Address · Unhealthy**, and the hint "The server cannot load the SSH key." (`identity_unavailable`)                                           | The SSH credential holds no key that the server generated, or the server cannot start its SSH agent. Open **Credentials**, then **Git**, and select **Rotate key** on the credential. Add the new public key as a deploy key. If the fault stays, read `podman logs kanthord`.                                                                                                                                                                                                                                                          |
| `system.files.publish_failed` from `auth jwt generate --output`                                                                                                                                   | The file exists in the volume. Remove it with `podman exec kanthord rm <path>`, then run the command again.                                                                                                                                                                                                                                                                                                                                                                                                                             |
