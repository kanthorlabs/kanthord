# Run kanthord in a container

[How-to guides](README.md)

Run the published kanthord container image with Podman or Docker. The image contains the server, the CLI and the dashboard. The guide ends with a saved repository binding in the dashboard.

## Before you start

- Podman or Docker on the host.
- A browser on the same host.
- A free host port for the dashboard, for example `8080`.
- Host port `1455` free, only for the **Browser** mode of the OpenAI Codex sign-in of step 6. Without that mode, remove `-p 127.0.0.1:1455:1455` from the command of step 3.
- A GitHub repository that you can administer, for the deploy key of step 5.

Run every command of this guide in a terminal on the host. `podman run` and `podman exec` run the `kanthord`, `sed`, `ls`, `rm` and `chmod` parts inside a container. Inside the container, `~` is `/var/lib/kanthord`, the volume.

The commands use Podman. With Docker, write `docker` in place of `podman` in each command. Where a Docker command differs, the guide shows the Docker form.

Replace each placeholder with your value:

| Placeholder       | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| `<version>`       | The image version, for example `28.0.1`, or `latest`.                   |
| `<port>`          | The host port of the dashboard, for example `8080`.                     |
| `<git name>`      | The name of the author of the agent commits, for example `Alice Smith`. |
| `<git email>`     | The email of that author, for example `alice@example.com`.              |
| `<your username>` | Your user name in the dashboard, for example `alice`.                   |
| `<owner>`         | The GitHub owner of the repository, for example `acme`.                 |
| `<repository>`    | The GitHub repository name, for example `app`.                          |

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
podman run -d --name kanthord --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 -v kanthord:/var/lib/kanthord -p 127.0.0.1:<port>:31415 -p 127.0.0.1:1455:1455 -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version>
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

A running server answers HTTP `200` with a JSON service map that starts with `{"status":"ok"`. If `curl` fails, wait 2 s and run it again. See [liveness](../reference/gateway/liveness.md).

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

For the first task, follow [From a fresh install to the first task](../tutorials/first-task.md) from its [step 2](../tutorials/first-task.md#2-read-the-onboarding-page). The Onboarding page of the dashboard replaces steps 5 and 6 of this guide. The tutorial links to them only for the screen details.

## 5. Connect a repository

The server reads and pushes a repository over SSH. The server creates the SSH key and keeps the private key encrypted in its database. You copy only the public key. The server writes no file under `~/.ssh`, that is `/var/lib/kanthord/.ssh`, and reads none. A new volume holds no SSH file.

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
5. The sheet reads the host key of `github.com` from `api.github.com` and pins it. The row **Host key of github.com** shows **Pinned** and the fingerprint. On the first pin, it also shows "Host key pinned from api.github.com". Check the fingerprint as the paragraph after this list shows.
6. Choose the SSH credential that you created, for example `app`.
7. Keep **Base branch** `main`, or enter the default branch of the repository.
8. Select **Verify**. Both lines show **Healthy**: **Address · Healthy** and **SSH credential · Healthy**.
9. Select **Save binding**.

The pin is the host key that the server trusts for `github.com`. Every binding with the host `github.com` uses it. To compare it, open the [SSH key fingerprints of GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). The pinned value equals the `ED25519` value. If the values differ, do not save the binding. Select **Pin again** in the **Host keys** panel, and compare again. **Credentials**, then **Git**, then the **Host keys** panel lists each pin.

### Move from the earlier SSH setup

An earlier version of this guide created the key with `ssh-keygen` in `/var/lib/kanthord/.ssh`. That setup used the alias `github` and the address `git@github:<owner>/<repository>.git`. The server now accepts only `github.com` and `ssh.github.com` as GitHub hosts. The credential `github` holds no key that the server generated. **Verify** on the binding row of the **Bindings** tab shows **Address · Unhealthy** and **SSH credential · Unhealthy**.

First run a newer image with [Use a newer image](#use-a-newer-image). Then do these repair steps in the dashboard:

1. Open **Credentials**, then **Git**. On the row of the credential `github`, select **Rotate key**. In the dialog, select **Rotate key** again.
2. The dialog shows the new public key. Select **Copy**. Then select **Done**.
3. Add the new public key to the repository as a deploy key with write access, as above.
4. Open the project, then the **Bindings** tab. Select **Edit** on the repository binding.
5. Change the address to `git@github.com:<owner>/<repository>.git`. The sheet pins the host key of `github.com`.
6. Select **Verify**. Both lines show **Healthy**. Select **Save binding**.
7. At GitHub, delete the old deploy key of the repository. Keep the key whose fingerprint equals the **Fingerprint** that the dialog of step 2 shows.

Repeat steps 1 to 7 for each SSH credential and repository binding of the earlier setup, for example `github-lib`. If you added the old key as an account SSH key, delete it in the SSH key settings of the account.

The rotation makes a new revision of the credential. The binding keeps the credential name, so the binding needs no other change. If repair step 3 is not done, the **Verify** of repair step 6 shows **Address · Unhealthy** with the hint "The repository host refused the SSH key." **SSH credential** shows **Healthy**.

The old files stay in the volume. The server ignores them, but an agent tool process of the server can still read them. After repair step 7 for every credential, remove them:

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

For the platform `anthropic-subscription`, you paste a `code#state` value from the provider page into **Paste code**. That sign-in needs no port 1455. See [Add the LLM credential](../tutorials/first-task.md#3-add-the-llm-credential) of the tutorial.

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

At the `worker` placement, a worker runs in a `kanthord serve worker` process outside the server container. One process is one worker instance. You add the instance once in the dashboard. Then a worker binding of a project lists the instance.

- An instance belongs to one worker, for example `coder@1`. Only a binding of that worker can list it.
- An instance runs one execution at a time.
- An instance holds its own copy of each LLM credential, sealed to its key. The server hands no server-held credential to an instance.
- The **Workers** screen and step 8.6 need a project. Without a project, **Workers** shows "No projects". To create one, open **Projects**, then **New project**, as [step 5](#5-connect-a-repository) shows.
- The first-task tutorial needs `coder@1` and `reviewer@1`. To run both at the `worker` placement, add one instance of each worker. Do step 8 once for each instance. For a second instance on the same worker host, skip steps 8.1 and 8.2.

Choose the steps for the place of the instance:

| The instance runs on                     | **Where does it run?**   | Steps                                                                                                          |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| A Linux host of your local network       | `Linux (systemd)`        | 8.1 to 8.6                                                                                                     |
| A Mac of your local network              | `macOS (foreground)`     | 8.1 to 8.6                                                                                                     |
| A container platform with no volume      | `Container`              | 8.1, then [Run a worker in a stateless container](#run-a-worker-in-a-stateless-container), then 8.4 to 8.6     |
| A second container on the container host | `Container on this host` | [Run a worker in a container on the same host](#run-a-worker-in-a-container-on-the-same-host), then 8.4 to 8.6 |

The steps use these placeholders in addition to the table at the start of this guide:

| Placeholder     | Value                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `<name>`        | The name of the worker instance, for example `coder-1`. You choose it in step 8.3.                       |
| `<LAN address>` | The address of the container host on your local network, for example `192.168.1.10`.                     |
| `<address>`     | The server address that the instance calls, for example `http://192.168.1.10:<port>`. Step 8.1 makes it. |
| `<arch>`        | `x64` for an `x86_64` worker host, `arm64` for an `arm64` worker host.                                   |
| `<user>`        | Your user name on the worker host.                                                                       |

### What the worker host needs

- `bash`, `git` 2.40 or later, and the OpenSSH 9.0 or later client programs `ssh`, `ssh-agent` and `ssh-add`. A missing program stops the start of the instance with `repository.connector.tool_missing`. A program below its minimum version stops the start with `repository.connector.tool_version`. The image holds these programs.
- No SSH key and no `~/.ssh` file. For each git operation, the instance asks the server to sign through the SSH signature relay. The private key stays on the server. An agent command runs as the user of the instance and can read the SSH keys of that user. Run the instance as a user with no `~/.ssh`.
- A network path to the SSH port of the repository host: port 22 for `github.com`, `gitlab.com` and `bitbucket.org`, port 443 for `ssh.github.com`, `altssh.gitlab.com` and `altssh.bitbucket.org`. The **Verify** of step 5 runs on the server, so it does not prove this path.
- A temporary directory path of 75 bytes or fewer that holds only letters, digits, `/`, `.`, `_` and `-`. The instance reads `TMPDIR`, else `TMP` or `TEMP`, else it uses `/tmp`. For each git operation, the instance makes an SSH agent socket in that directory. A longer path or another character fails every SSH operation with `repository.connector.ssh_agent_failed`.
- `curl`, for the downloads of step 8.2.
- `sudo`, for the install of step 8.2.
- A network path to the server. Step 8.1 makes it.

### 8.1 Open the server to your network

The command of step 3 publishes the server on the loopback address of the container host only. A worker host of your network needs the `<LAN address>` of the container host. Skip this step for an instance in a container on the container host.

1. On the container host, remove the server container. The volume keeps the configuration and the database.

   ```sh
   podman rm -f kanthord
   ```

   The command prints `kanthord`.

2. Start the server again. This is the command of step 3 with `-p <port>:31415` in place of `-p 127.0.0.1:<port>:31415`. If you removed `-p 127.0.0.1:1455:1455` in step 3, remove it here too.

   ```sh
   podman run -d --name kanthord --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 -v kanthord:/var/lib/kanthord -p <port>:31415 -p 127.0.0.1:1455:1455 -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version>
   ```

   The command prints the ID of the new container.

   `-p <port>:31415` publishes the dashboard and the API on every interface of the container host. On a Linux host, you can keep the loopback and LAN form: `-p 127.0.0.1:<port>:31415 -p <LAN address>:<port>:31415`. Podman on macOS refuses that form with `Error: rootlessport conflict with ID 2`.

3. On the worker host, check the path to the server:

   ```sh
   curl http://<LAN address>:<port>/api/liveness
   ```

   The answer starts with `{"status":"ok"`. If `curl` fails, wait 2 s and run it again.

`<address>` is now `http://<LAN address>:<port>`. Keep the dashboard on `http://localhost:<port>`. The server accepts the calls of a worker instance with any `Host` header, so `gateway.allowed_hosts` needs no change.

Every host of your network can now reach the API over plain HTTP. Use this setup only on a network that you trust. On another network, give the server an HTTPS address, as [Run kanthord on a VPS](run-on-a-vps.md) or [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md) shows. Then `<address>` is that HTTPS address.

`kanthord serve worker` refuses an `http` address whose host does not resolve to a loopback or private address. The refusal is `worker.start.endpoint_insecure`. The private addresses are `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fc00::/7` and `fe80::/10`.

### 8.2 Install the binary on the worker host

The binary must have the version of the server. The instance refuses another version with `worker.version.mismatch`.

1. On the container host, read the version of the server:

   ```sh
   podman exec kanthord kanthord --version
   ```

   The command prints the version, for example `28.0.1`. In the commands below, write it in place of `<version>`.

On a Linux worker host:

2. Download the binary:

   ```sh
   curl -fLO https://github.com/kanthorlabs/kanthord/releases/download/v<version>/kanthord-linux-<arch>
   ```

3. Download the checksum file:

   ```sh
   curl -fLO https://github.com/kanthorlabs/kanthord/releases/download/v<version>/SHA256SUMS
   ```

4. Check the download:

   ```sh
   sha256sum --ignore-missing -c SHA256SUMS
   ```

   The command prints `kanthord-linux-<arch>: OK`.

5. Install the binary:

   ```sh
   sudo install -m 755 kanthord-linux-<arch> /usr/local/bin/kanthord
   ```

   The command prints nothing.

6. Check the installed version:

   ```sh
   kanthord --version
   ```

   The command prints `<version>`.

On a Mac:

2. Download the binary:

   ```sh
   curl -fLO https://github.com/kanthorlabs/kanthord/releases/download/v<version>/kanthord-darwin-arm64
   ```

3. Download the checksum file:

   ```sh
   curl -fLO https://github.com/kanthorlabs/kanthord/releases/download/v<version>/SHA256SUMS
   ```

4. Check the download:

   ```sh
   shasum -a 256 --ignore-missing -c SHA256SUMS
   ```

   The command prints `kanthord-darwin-arm64: OK`.

5. Remove the macOS quarantine flag. Without this command, macOS refuses to start a binary that a browser downloaded.

   ```sh
   xattr -d com.apple.quarantine kanthord-darwin-arm64
   ```

   After a `curl` download, the command prints `xattr: kanthord-darwin-arm64: No such xattr: com.apple.quarantine`. That message is expected.

6. Install the binary:

   ```sh
   sudo install -m 755 kanthord-darwin-arm64 /usr/local/bin/kanthord
   ```

   The command prints nothing.

7. Check the installed version:

   ```sh
   kanthord --version
   ```

   The command prints `<version>`.

### 8.3 Add the instance and start it

The dashboard shows the instance configuration only once. It holds the private key of the instance. Open a terminal on the worker host before you start.

1. In the dashboard, open **Workers**. Select the card of the worker, for example `coder@1`.
2. If the worker has no instance, select **Advanced: worker instances**. The **Instances** section opens.
3. In the **Instances** section, select **Add instance**.
4. Enter a **Name**, for example `coder-1`. Start with a lowercase letter. Use only lowercase letters, digits and hyphens. This name is `<name>`.
5. In **Where does it run?**, choose `Linux (systemd)` or `macOS (foreground)`.
6. In **Address**, enter `<address>`. The field is empty when the dashboard runs on `localhost`.
7. Select **Create instance**. The sheet shows the **Instance configuration** and the copy block of the host kind.
8. Select **Copy** next to **Instance configuration**. Keep the sheet open.

The copy block of the sheet repeats step 8.2 and the commands of the list below, except the log command. If you close the sheet before the paste, select **Reset key** on the instance page. Reset key gives a new instance configuration.

On a Linux worker host, do these steps as `<user>`:

1. Let the user units of `<user>` run without a login session:

   ```sh
   loginctl enable-linger
   ```

   The command prints nothing.

2. Write the instance file. The command reads the instance configuration from standard input. Paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   kanthord worker join
   ```

   The command prints `created: /home/<user>/.config/kanthord/workers/<name>.yaml`. The file has mode `0600`.

3. In the dashboard, select **Done**.

4. Create the directory of the user units:

   ```sh
   mkdir -p ~/.config/systemd/user
   ```

   The command prints nothing.

5. Write the template unit `kanthord-worker@.service`:

   ```sh
   cat > ~/.config/systemd/user/kanthord-worker@.service <<'EOF'
   [Unit]
   Description=KanthorD worker instance %i

   [Service]
   ExecStart=/usr/local/bin/kanthord serve worker --instance %i
   Restart=on-failure
   RestartPreventExitStatus=3

   [Install]
   WantedBy=default.target
   EOF
   ```

   The command prints nothing.

6. Create the directory of the settings of this instance:

   ```sh
   mkdir -p ~/.config/systemd/user/kanthord-worker@<name>.service.d
   ```

   The command prints nothing.

7. Write the settings of this instance. They set the author of the agent commits and turn off core dumps. The memory of the instance holds the plaintext of its LLM credentials.

   ```sh
   cat > ~/.config/systemd/user/kanthord-worker@<name>.service.d/kanthord.conf <<'EOF'
   [Service]
   Environment="GIT_AUTHOR_NAME=<git name>" "GIT_AUTHOR_EMAIL=<git email>" "GIT_COMMITTER_NAME=<git name>" "GIT_COMMITTER_EMAIL=<git email>"
   LimitCORE=0
   EOF
   ```

   The command prints nothing.

8. Load the new units:

   ```sh
   systemctl --user daemon-reload
   ```

   The command prints nothing.

9. Start the instance, and start it again at each boot:

   ```sh
   systemctl --user enable --now kanthord-worker@<name>
   ```

   The command prints one line that starts with `Created symlink`.

10. Read the log of the instance:

    ```sh
    journalctl --user -u kanthord-worker@<name> --no-pager -n 5
    ```

    One line holds `"msg":"Worker instance ready"` and `"config_source":"file"`.

On a Mac, nothing restarts the process, so keep its terminal open:

1. Write the instance file. The command reads the instance configuration from standard input. Paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   kanthord worker join
   ```

   The command prints `created: /Users/<user>/.config/kanthord/workers/<name>.yaml`. The file has mode `0600`.

2. In the dashboard, select **Done**.

3. Set the author of the agent commits for this terminal:

   ```sh
   export GIT_AUTHOR_NAME="<git name>" GIT_AUTHOR_EMAIL="<git email>" GIT_COMMITTER_NAME="<git name>" GIT_COMMITTER_EMAIL="<git email>"
   ```

   The command prints nothing.

4. Start the instance:

   ```sh
   kanthord serve worker --instance <name>
   ```

   The terminal shows a JSON line that holds `"msg":"Worker instance ready"` and `"config_source":"file"`.

After a restart of the Mac, open a terminal and do steps 3 and 4 again. Without the `GIT_*` variables, a commit has the author `kanthord <kanthord@localhost>`.

### 8.4 Check the connection

1. In the dashboard, open **Workers**, then the card of the worker. Select the instance `<name>` in the **Instances** section.
2. The **Connection** row of the instance page shows `Connected · <connection name> · last heartbeat <time>`. `<connection name>` is the host name of the worker host, or of the container. `<time>` is the UTC time of the last heartbeat, for example `2026-10-21 09:30 UTC`.

When the row shows `Not connected`, read the log of the instance. See [Troubleshooting](#troubleshooting).

### 8.5 Give the instance the LLM credential

The agents of the worker call a model with an LLM credential, for example `claude` of the [first-task tutorial](../tutorials/first-task.md#3-add-the-llm-credential). At the `worker` placement, each listed instance needs its own copy of that credential, with the same name. Without the copy, **Save binding** of step 8.6 fails with `agent.configuration.credential_holder_mismatch`.

For an API key platform, for example `anthropic`:

1. On the instance page, select **Add credential** in the **Credentials** section.
2. Enter the **Name** of the credential, for example `claude`.
3. Choose the **Platform** of that credential, for example `anthropic`. A name holds one platform for every copy.
4. Paste the key into **API Key**.
5. Select **Create credential**. The **Credentials** section shows the row `claude · anthropic (v1)`.

The server seals the copy to the key of the instance and keeps no plaintext. The server does not check an instance copy with the provider. The connected instance checks the copy and reports the result. The row then shows a health line, for example **Healthy** and "Reported by builder-1 at <time>." A refused key shows **Unhealthy** with a hint. After a server restart, the row shows **Unknown** until the next report of the instance.

For `anthropic-subscription`, the instance runs the sign-in itself. The instance must show `Connected` in step 8.4. Otherwise the sign-in fails with `credential.login.instance_unavailable`.

1. On the instance page, select **Add credential** in the **Credentials** section.
2. Enter the **Name** of the credential, for example `claude`.
3. Choose the **Platform** `anthropic-subscription`, then select **Start sign-in**. The instance takes the sign-in at its next heartbeat, within 15 s. Then the panel shows the address and the field **Paste code**.
4. Open the address in a browser. Sign in to the Anthropic account, then approve the access.
5. The provider page shows a code of the form `code#state`. Copy the whole value.
6. Paste the value into **Paste code**, then select **Send code**.
7. The **Credentials** section shows the row `claude · anthropic-subscription (v1)`.

Do steps 3 to 6 within 15 minutes. For `openai-codex` and `github-copilot`, the instance uses the device code mode. The panel then shows an address and a code. Open the address, and enter the code.

The CLI can also make a copy with the option `--holder`. See [LLM credentials](../reference/llm/credential.md) and [Login on a worker instance](../reference/llm/login.md#login-on-a-worker-instance).

### 8.6 Bind the instance

1. In the project, open the **Bindings** tab. Select **Add** in the **Workers** section.
2. Enter a **Name**, for example `coder-remote`. Use a name that the project does not hold.
3. Choose the **Worker** of the instance, for example `coder@1`.
4. The **Agents** section shows the agent of the worker, for example `swe@1`. When the agent shows the badge `Not enabled`, select **Enable swe@1**. Enter an **Agent provider name**, for example `claude`. Choose the **LLM credential** and the **Model identifier**. Then select **Enable agent**. The badge then shows `Enabled`.
5. Open **Advanced settings**, and turn on **Worker placement**. The `Server` and `Container` cards turn off, and **Instances** replaces **Instance count**.
6. In **Instances**, select `<name>`.
7. Select **Save binding**.

Within about 15 s, the instance registers for the binding. Its log shows a line that holds `"msg":"Worker application ready"` and `"resource_identity":"worker:kanthord:<binding name>"`. `<binding name>` is the name of step 2. The **Live registrations** item of the **Readiness** panel shows `Done`.

When the instance is not connected, the **Live registrations** item shows "Instance <name> is not connected. Start kanthord serve worker with its configuration."

One instance is one trust boundary over every project that it serves. An agent command of any served binding can read the instance key, its credential copies and its workspaces. The binding sheet and the instance page show a notice when the instance serves bindings of two or more projects. List an instance only in bindings of projects that trust each other.

### The files of an instance

| File or directory                                        | On a Linux host or a Mac                  | In the image                                        |
| -------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| The instance file, mode `0600`                           | `~/.config/kanthord/workers/<name>.yaml`  | None. The container reads `KANTHORD_WORKER_CONFIG`. |
| The data directory: `workspaces/`, `transcripts/`, `pi/` | `~/.local/share/kanthord/workers/<name>/` | `/var/lib/kanthord/data/kanthord/workers/<name>/`   |
| The log                                                  | The journal of the unit, or the terminal  | `podman logs`                                       |

`XDG_CONFIG_HOME` and `XDG_DATA_HOME` move the two directories. Each instance holds its own data directory, so two instances on one host share no workspace. A restart with the same configuration is the same instance. It keeps its workspaces, and it resumes its `running` execution.

A second process with the same configuration takes the connection of the instance. The first process then stops its agent commands and exits with status `3` and `worker.instance.superseded`. Until that exit, both processes can act in the same workspace, for at most one heartbeat interval of 15 s. Run one process for each instance.

### Run a worker in a stateless container

The host kind `Container` runs the instance on a container platform with no writable configuration. The container reads the instance configuration from the variable `KANTHORD_WORKER_CONFIG`, so it needs no volume for its identity. Use these settings on any platform:

- Store the instance configuration as a secret of the platform. Give it to the container as the variable `KANTHORD_WORKER_CONFIG`.
- Use the image `docker.io/kanthorlabs/kanthord:<version>` with the command `serve worker`.
- Set the `GIT_*` variables of step 3.
- Run the container with no health check, for example with `podman run --no-healthcheck`. The health check of the image reads a server, and a worker container serves no server.
- Run one replica. A second replica takes the connection, and the first exits with status `3`. A restart loop with `worker.instance.superseded` means two deployments of one instance configuration.
- Publish no port. The instance opens every connection to the server.

Without a volume, a new container starts with no workspace. The identity, the credential copies and the bindings stay on the server. A resumed execution clones the repository again and checks out the pushed node branch. The work that the lost workspace did not push is lost.

The image declares a health check that reads the server on `127.0.0.1:31415`. A worker container serves no server, so the worker commands of this guide pass `--no-healthcheck`. The [instance page](#84-check-the-connection) of the dashboard shows the health of the instance: the connection and the last heartbeat.

This example runs the container with Podman or Docker on a host of your network. Podman reads the configuration from a Podman secret. Docker reads it from an env file of mode 0600 with `--env-file`, and you delete the file after the start.

`docker inspect kanthord-worker-<name>` shows the value of `KANTHORD_WORKER_CONFIG` to every user that can run `docker`. A member of the `docker` group can already read every volume on the host.

1. Do steps 1 to 8 of the dashboard list of [8.3](#83-add-the-instance-and-start-it). In **Where does it run?**, choose `Container`. In **Container runtime**, choose `Podman` or `Docker`.
2. On the container host of the instance, store the instance configuration as a Podman secret. Paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   podman secret create kanthord-worker-<name> -
   ```

   The command prints the ID of the secret.

   With Docker, write the instance configuration to an env file of mode 0600. Type `KANTHORD_WORKER_CONFIG=`, paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   (umask 077 && cat > <name>.env)
   ```

   The command prints nothing.

3. In the dashboard, select **Done**.
4. Start the instance:

   ```sh
   podman run -d --name kanthord-worker-<name> --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --secret kanthord-worker-<name>,type=env,target=KANTHORD_WORKER_CONFIG -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

   The command prints the ID of the new container.

   With Docker, start the instance with the env file:

   ```sh
   docker run -d --name kanthord-worker-<name> --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --env-file <name>.env -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

   The command prints the ID of the new container.

   With Docker, delete the env file. The container keeps the value.

   ```sh
   rm <name>.env
   ```

   The command prints nothing.

5. Read the log of the instance:

   ```sh
   podman logs kanthord-worker-<name>
   ```

   One line holds `"msg":"Worker instance ready"` and `"config_source":"env"`.

The image directory `/var/lib/kanthord` becomes an anonymous volume. `podman restart` keeps the workspaces. A new container starts with none.

Then do steps [8.4](#84-check-the-connection) to [8.6](#86-bind-the-instance).

### Run a worker in a container on the same host

The host kind `Container on this host` runs the instance in a second container beside the server container `kanthord`. The two containers share a container network. The instance reaches the server by the container name, at `http://kanthord:31415`. With Docker, write `docker` in place of `podman` in steps 1, 2 and 7. Steps 4 and 6 show the Docker form. [Run a worker in a stateless container](#run-a-worker-in-a-stateless-container) states who can read the value with Docker.

1. Create a network:

   ```sh
   podman network create kanthord-net
   ```

   The command prints `kanthord-net`.

2. Connect the server container to the network:

   ```sh
   podman network connect kanthord-net kanthord
   ```

   The command prints nothing.

3. Do steps 1 to 8 of the dashboard list of [8.3](#83-add-the-instance-and-start-it), but skip step 6. In **Where does it run?**, choose `Container on this host`. **Address** then shows `http://kanthord:31415`. In **Container runtime**, choose `Podman` or `Docker`.
4. Store the instance configuration as a Podman secret. Paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   podman secret create kanthord-worker-<name> -
   ```

   The command prints the ID of the secret.

   With Docker, write the instance configuration to an env file of mode 0600. Type `KANTHORD_WORKER_CONFIG=`, paste the value, press `Enter`, then press `Ctrl-D`.

   ```sh
   (umask 077 && cat > <name>.env)
   ```

   The command prints nothing.

5. In the dashboard, select **Done**.
6. Start the instance:

   ```sh
   podman run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --secret kanthord-worker-<name>,type=env,target=KANTHORD_WORKER_CONFIG -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

   The command prints the ID of the new container.

   With Docker, start the instance with the env file:

   ```sh
   docker run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --env-file <name>.env -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<version> serve worker
   ```

   The command prints the ID of the new container.

   With Docker, delete the env file. The container keeps the value.

   ```sh
   rm <name>.env
   ```

   The command prints nothing.

7. Read the log of the instance:

   ```sh
   podman logs kanthord-worker-<name>
   ```

   One line holds `"msg":"Worker instance ready"` and `"config_source":"env"`.

Then do steps [8.4](#84-check-the-connection) to [8.6](#86-bind-the-instance).

The image holds `bash`, `git`, the OpenSSH client and the `kanthord` binary of the server version. The worker container keeps its workspaces in an anonymous volume. `podman restart kanthord-worker-<name>` keeps them. A new container starts with none, as [Run a worker in a stateless container](#run-a-worker-in-a-stateless-container) states.

`podman restart kanthord` keeps the network connection. After `podman rm` of the server, do the worker steps of [Use a newer image](#use-a-newer-image).

### Move a server binding to the worker placement

A later write cannot change the placement of a worker binding. The tutorial bindings `coder` and `reviewer` keep the placement `server`. To move `coder` to a worker instance:

1. In the project, open the **Bindings** tab. Select **Remove** on the `coder` row.
2. In the dialog, select **Make unavailable instead**. The binding keeps its name, and its instance count becomes `0`. The live registration of the binding ends, and the binding claims no node.
3. Add an instance of `coder@1`, and bind it with another name at the placement `worker`. Do steps 8.1 to 8.6, for example with the instance `coder-1` and the binding `coder-remote`.

Do the same for `reviewer`, for example with the instance `reviewer-1` and the binding `reviewer-remote`. Do not select **Remove binding** in step 2. While a node is not `Completed`, the server refuses the removal of the only `coder@1` binding with `project.bindings.worker.node_unmatched`. A binding with instance count `0` still covers the states of the node. To use the binding again, set its instance count above `0`.

### Clean up a worker host of an earlier version

An earlier version ran `kanthord serve worker` with a machine token in `cli.yaml`. That setup does not work with this version. On each such host, do these steps:

1. Stop the old `kanthord serve worker` process. For a container of the earlier guide, remove it with `podman rm -f kanthord-<binding name>`. `<binding name>` is the name of the old worker binding.
2. Remove the old workspaces and transcripts. The instance keeps its files in its own data directory now.

   ```sh
   rm -rf ~/.local/state/kanthord/workspaces ~/.local/state/kanthord/transcripts
   ```

   The command prints nothing.

3. If the host runs no kanthord server, remove the old pi directory. A server on the same host uses that directory.

   ```sh
   rm -rf ~/.local/state/kanthord/pi
   ```

   The command prints nothing.

4. If `~/.config/kanthord/cli.yaml` holds a `client_secret` line, remove the file. Every CLI command that reads this file refuses it with `cli.config.invalid`.

   ```sh
   rm ~/.config/kanthord/cli.yaml
   ```

   The command prints nothing.

5. For a container of the earlier guide, remove its volume:

   ```sh
   podman volume rm kanthord-<binding name>
   ```

   The command prints `kanthord-<binding name>`.

With `XDG_STATE_HOME` or `XDG_CONFIG_HOME` set, write `$XDG_STATE_HOME/kanthord` or `$XDG_CONFIG_HOME/kanthord` in place of the paths above. Then add an instance on the host with step 8.

## Use a newer image

If the server runs a toolchain image, build the image of `<new version>` first, and use it in the command of step 3. See [Add a toolchain to the worker image](add-a-toolchain-to-the-worker-image.md).

`podman restart kanthord` keeps the old image. To run a newer image on the same volume, write the new version in place of `<new version>`:

```sh
podman pull docker.io/kanthorlabs/kanthord:<new version>
podman stop kanthord
podman run --rm -v kanthord:/var/lib/kanthord docker.io/kanthorlabs/kanthord:<new version> upgrade
podman rm kanthord
```

Then run the command of step 3 again, with `<new version>` in place of `<version>` and the same `GIT_*` values. If you did step 8.1, run the command of step 8.1 in its place. See [upgrade](../reference/upgrade.md).

A worker instance checks the server version at its start and at each heartbeat. After the upgrade of the server, an instance of the old version exits with `worker.version.mismatch`. Upgrade each instance to `<new version>`.

For an instance in a container on the same host, do these steps. See [Run a worker in a container on the same host](#run-a-worker-in-a-container-on-the-same-host). With Docker, write `docker` in place of `podman` in steps 1 and 2. Steps 2 and 3 show the Docker form.

1. Connect the new server container to the network. `podman rm kanthord` removed the old connection.

   ```sh
   podman network connect kanthord-net kanthord
   ```

   The command prints nothing.

2. With Docker, first copy the instance configuration of the old container to an env file of mode 0600:

   ```sh
   docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' kanthord-worker-<name> | grep '^KANTHORD_WORKER_CONFIG=' | (umask 077 && cat > <name>.env)
   ```

   The command prints nothing. Check that the env file holds the line:

   ```sh
   grep -c '^KANTHORD_WORKER_CONFIG=' <name>.env
   ```

   The command prints `1`. If it prints `0`, stop. Do not remove the container, because it holds the only copy of the value.

   Remove the container of the instance and its anonymous volume:

   ```sh
   podman rm -f -v kanthord-worker-<name>
   ```

   The command prints `kanthord-worker-<name>`.

3. Start the instance with the new version. The Podman secret `kanthord-worker-<name>` stays.

   ```sh
   podman run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --secret kanthord-worker-<name>,type=env,target=KANTHORD_WORKER_CONFIG -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<new version> serve worker
   ```

   The command prints the ID of the new container.

   With Docker, start the instance with the env file, then delete the file:

   ```sh
   docker run -d --name kanthord-worker-<name> --network kanthord-net --cap-drop=ALL --security-opt=no-new-privileges --ulimit core=0 --no-healthcheck --env-file <name>.env -e GIT_AUTHOR_NAME="<git name>" -e GIT_AUTHOR_EMAIL="<git email>" -e GIT_COMMITTER_NAME="<git name>" -e GIT_COMMITTER_EMAIL="<git email>" docker.io/kanthorlabs/kanthord:<new version> serve worker
   rm <name>.env
   ```

   The command prints the ID of the new container.

For an instance on a Linux host, do these steps on that host:

1. Install the binary of `<new version>` with steps 2 to 6 of [8.2](#82-install-the-binary-on-the-worker-host). Write `<new version>` in place of `<version>`.
2. Start the instance again:

   ```sh
   systemctl --user restart kanthord-worker@<name>
   ```

   The command prints nothing.

For an instance on a Mac, install the binary of `<new version>` with steps 2 to 7 of [8.2](#82-install-the-binary-on-the-worker-host). Then do steps 3 and 4 of the Mac list of [8.3](#83-add-the-instance-and-start-it) again. For an instance in a stateless container, change the image tag to `<new version>`. The instance keeps its configuration, its credential copies and its bindings. See [upgrade](../reference/upgrade.md#other-state).

## Troubleshooting

In a **Verify** row, the value in parentheses is the `failure_reason` of the check answer. The dashboard shows the hint, not the value.

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
| **Verify** shows **Address · Unhealthy** and the hint "The server cannot reach the repository host." (`host_unreachable`)                                                                         | The server has no network path to the repository host on its SSH port: 443 for `ssh.github.com`, `altssh.gitlab.com` and `altssh.bitbucket.org`, 22 for every other host. Check the DNS and that outbound port of the container host. If the network blocks the outbound port 22, change the address host to `ssh.github.com`, `altssh.gitlab.com` or `altssh.bitbucket.org`, for example `git@ssh.github.com:<owner>/<repository>.git`, and pin its host key.                                                                          |
| **Verify** shows **Address · Unhealthy** and the hint "The check failed for an unknown cause, or it exceeded its deadline." (`unclassified`)                                                      | Select **Verify** again. If the failure stays, read `podman logs kanthord`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The binding sheet shows "The host key of github.com was not read." and **Save binding** stays off                                                                                                 | The server cannot reach `api.github.com` over HTTPS. Check the network of the container host, then select **Retry**.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Verify** shows **Address · Unhealthy** and the hint "The address is not valid, or its host is not a host of the platform." (`address_invalid`)                                                  | The address does not have the form `git@<host>:<owner>/<repository>.git`, or its host is not `github.com` or `ssh.github.com` for GitHub. An address with the alias `github` of the earlier guide gets this result. In the binding sheet, the **Address** field also shows the host rule. See [Move from the earlier SSH setup](#move-from-the-earlier-ssh-setup).                                                                                                                                                                      |
| **Verify** shows **SSH credential · Unhealthy** or **Address · Unhealthy**, and the hint "The server cannot load the SSH key." (`identity_unavailable`)                                           | The SSH credential holds no key that the server generated, or the server cannot start its SSH agent. Open **Credentials**, then **Git**, and select **Rotate key** on the credential. Add the new public key as a deploy key. If the fault stays, read `podman logs kanthord`.                                                                                                                                                                                                                                                          |
| The instance page shows `Not connected`                                                                                                                                                           | The process of the instance does not run, or it cannot reach `<address>`. Read the log of the instance: `journalctl --user -u kanthord-worker@<name>`, the terminal on a Mac, or `podman logs kanthord-worker-<name>`. The rows below name each code of that log.                                                                                                                                                                                                                                                                       |
| `journalctl --user` prints "No journal files were found"                                                                                                                                          | The journal of the host keeps no user journal. Run `sudo journalctl _SYSTEMD_USER_UNIT=kanthord-worker@<name>.service`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `worker.start.instance_config_absent`                                                                                                                                                             | The process finds no instance configuration. On a Linux host or a Mac, run `kanthord worker join` first, and pass the same `<name>` to `--instance`. In a container, give the secret as the variable `KANTHORD_WORKER_CONFIG`.                                                                                                                                                                                                                                                                                                          |
| `worker.start.instance_config_conflict`                                                                                                                                                           | `KANTHORD_WORKER_CONFIG` is set while the instance file `workers/<name>.yaml` exists. Remove the variable, or remove the file.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `worker.instance.config_invalid`                                                                                                                                                                  | The pasted value is not complete, or `--instance` differs from the name in the configuration. Paste the whole value again. If you lost the value, select **Reset key** on the instance page.                                                                                                                                                                                                                                                                                                                                            |
| `cli.worker.join.config_exists`                                                                                                                                                                   | The instance file of the name exists. After a **Reset key**, run `kanthord worker join --force` to replace it.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `worker.start.endpoint_insecure`                                                                                                                                                                  | `<address>` uses `http`, and its host does not resolve to a loopback or private address. Use an HTTPS address, or an address of your local network. See [8.1](#81-open-the-server-to-your-network).                                                                                                                                                                                                                                                                                                                                     |
| `worker.version.mismatch`                                                                                                                                                                         | The binary or the image of the instance has another version than the server. Install the version of the server. See [8.2](#82-install-the-binary-on-the-worker-host) and [Use a newer image](#use-a-newer-image).                                                                                                                                                                                                                                                                                                                       |
| `worker.instance.not_found`                                                                                                                                                                       | A **Reset key** or an **Archive** ended the configuration of the instance. After a **Reset key**, write the new configuration with `kanthord worker join --force`, or replace the Podman secret. With Docker, write a new env file and run the container again.                                                                                                                                                                                                                                                                         |
| `loginctl enable-linger` asks for a password, or fails with "Access denied"                                                                                                                       | The host allows the change only to an administrator. Run `sudo loginctl enable-linger <user>`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The process exits with status `3` and `worker.instance.superseded`                                                                                                                                | A second process with the same instance configuration took the connection. The diagnostic names its `connection_name`. Run one process for each instance. systemd does not restart a process that exits with status `3`.                                                                                                                                                                                                                                                                                                                |
| **Save binding** fails with `agent.configuration.credential_holder_mismatch`                                                                                                                      | A listed instance holds no live copy of a credential that the agents use. Do [8.5](#85-give-the-instance-the-llm-credential) for each listed instance.                                                                                                                                                                                                                                                                                                                                                                                  |
| The sign-in of an instance fails with `credential.login.instance_unavailable`                                                                                                                     | The instance is not connected. Start it, and check [8.4](#84-check-the-connection). Then start the sign-in again.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The health status of a worker container is `unhealthy`                                                                                                                                            | The container started without `--no-healthcheck`. The health check of the image reads a server on `127.0.0.1:31415`, and a worker container serves no server. The status does not stop the instance. Read the connection on the instance page. The start commands of this guide pass `--no-healthcheck`.                                                                                                                                                                                                                                |
