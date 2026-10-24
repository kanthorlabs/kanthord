# Isolate worker instances in containers

[How-to guides](README.md)

Run the instances of a worker binding at the `container` placement. The server then starts one container for each instance on its own host, with Podman or Docker.

At the `server` placement, an agent command runs as the server user. It can read every credential of the server, `master_key` and the database. At the `container` placement, an agent command runs in the container of its instance. It reads no file of the server and cannot signal the server process. Each instance runs in the container `kanthord_slot_<client_id>` and keeps its state in its own volume `kanthord_slot_<client_id>`.

The server must run as the kanthord binary on the host. A server inside a container cannot start containers, so `container` is off there. To install the binary, use [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md) or [Run kanthord on a VPS](run-on-a-vps.md).

## Before you start

- The kanthord server binary, installed and started on the host.
- One container runtime on the same host, for the user that runs the server:
  - On a Mac: a Podman machine or Docker Desktop.
  - On Linux: rootless Podman or rootless Docker. The server refuses a rootful runtime when the server user is not root.
- The image of the server version. The default is `docker.io/kanthorlabs/kanthord:<version>`. For a toolchain such as Node.js, follow [step 4 of Add a toolchain to the worker image](add-a-toolchain-to-the-worker-image.md#4-add-a-toolchain-at-the-container-placement).

Replace each placeholder with your value:

| Placeholder      | Value                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `<version>`      | The version of the server, for example `28.0.1`.                                                                                       |
| `<project-id>`   | The **Identity** value under **Details** on the project page, for example `project_01M5…`.                                             |
| `<binding-id>`   | The `id` of the repository binding that `kanthord project binding list <project-id> --kind repository --token '<human token>'` prints. |
| `<human token>`  | The token of [auth jwt generate](../reference/auth/jwt.md).                                                                            |
| `<client_id>`    | The part after `kanthord_slot_` in the container names that `podman ps --filter label=io.kanthord.owner --format '{{.Names}}'` prints. |
| `<execution_id>` | The identity of an execution, for example `execution_01M5…`.                                                                           |

The commands use Podman. With Docker, write `docker` in place of `podman`.

## 1. Prepare the container runtime

### On a Mac with Podman

```sh
brew install podman
podman machine init --memory 8192
podman machine start
```

The default machine holds 2 GiB of memory, and every container shares it. Two or more instances that run `npm` need 8 GiB. To change an existing machine, stop it first:

```sh
podman machine stop
podman machine set --memory 8192
podman machine start
```

Start the machine again after each restart of the Mac. While the machine is stopped, the instances do not start. They start by themselves after `podman machine start`.

### On Linux, as a desktop user

Install Podman with the package manager of the distribution, for example `sudo apt install podman`. Rootless Podman then works with no other step.

Install the binary `kanthord-linux-x64` or `kanthord-linux-arm64` as [step 1 of Run kanthord on a VPS](run-on-a-vps.md#1-install-the-binary) shows. Then run `kanthord config init` and `kanthord serve` in a terminal as your user.

### On a VPS with the service user

The service user `kanthord` of [Run kanthord on a VPS](run-on-a-vps.md) is a system user. It has no subordinate uid range and no user session, so Podman needs these four steps:

1. Install Podman and the uid map tools:

   ```sh
   sudo apt install podman uidmap
   ```

   Read `/etc/subuid` and `/etc/subgid`. Choose a free range of 65536 ids, for example `1000000-1065535`. Give that range to the user:

   ```sh
   sudo usermod --add-subuids 1000000-1065535 --add-subgids 1000000-1065535 kanthord
   ```

2. Write `/var/lib/kanthord/.config/containers/containers.conf` as the user `kanthord`. The file replaces the systemd user session that the user lacks:

   ```sh
   sudo -u kanthord -H mkdir -p /var/lib/kanthord/.config/containers
   printf '[engine]\ncgroup_manager = "cgroupfs"\nevents_logger = "file"\n' | sudo -u kanthord -H tee /var/lib/kanthord/.config/containers/containers.conf
   ```

3. Add these lines to the `[Service]` section of `/etc/systemd/system/kanthord.service`. `XDG_RUNTIME_DIR` gives Podman the runtime directory that a user session gives otherwise:

   ```ini
   RuntimeDirectory=kanthord
   RuntimeDirectoryMode=0700
   Environment=XDG_RUNTIME_DIR=/run/kanthord
   KillMode=mixed
   ```

4. Restart the server:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl restart kanthord
   ```

`KillMode=mixed` sends the stop signal to the server process only. The server then stops each instance itself, and a live execution ends cleanly.

On the VPS, run every `podman` command of this guide as `sudo -u kanthord -H env XDG_RUNTIME_DIR=/run/kanthord podman …`.

## 2. Pull the image

Pull the image as the user that runs the server. The first start of an instance pulls it too, but that pull can take minutes.

```sh
podman pull docker.io/kanthorlabs/kanthord:<version>
```

On the VPS, run `sudo -u kanthord -H env XDG_RUNTIME_DIR=/run/kanthord podman pull docker.io/kanthorlabs/kanthord:<version>`.

The server adds its own version as the tag to the name in `worker.container_image`. The server builds an image from the [environment](https://github.com/kanthorlabs/kanthord-engine/blob/main/docs/cli/project.md#binding-environment) of each repository binding, and copies `kanthord` and `tini` from this image into it. A container waits until that environment is `ready`, then runs the environment image. Put a toolchain into the environment, not into this image. See [step 4 of Add a toolchain to the worker image](add-a-toolchain-to-the-worker-image.md#4-add-a-toolchain-at-the-container-placement).

## 3. Check the placement

In the project, open the **Bindings** tab, and select **Add** in the **Workers** section. **Placement** shows the `Container` card on, with the runtime that the server uses, for example "with Podman". When the card is off, it shows the reason. Under `runtime_failed`, the card stays on and shows the detail, because a save passes and the instances start after the runtime recovers. See [Troubleshooting](#troubleshooting).

## 4. Add the worker binding

1. In the project, open the **Bindings** tab. Select **Add** in the **Workers** section.
2. Enter a **Name**, for example `coder-box`. Use a name that the project does not hold.
3. Choose the **Worker**, for example `coder@1`.
4. Select the **Placement** card `Container`, and set the **Instance count**.
5. Select **Save binding**.

A later write cannot change the placement of a binding. To move an existing binding, follow [Move a server binding to the worker placement](run-in-a-container.md#move-a-server-binding-to-the-worker-placement). In its step 3, add a binding with another name at the placement `container`, as the list above shows. Skip the steps of the `worker` placement.

The first container of the binding starts only after the environment of its repository binding is `ready`. The first build pulls a devcontainer image, and it can take several minutes. Read the status of each repository binding:

```sh
kanthord project environment list <project-id> --token '<human token>'
```

Wait until `status` is `ready`. Then the **Workers** page shows each instance with `· container`. The runtime lists the containers of the server:

```sh
podman ps --filter label=io.kanthord.owner
```

On the VPS, run `sudo -u kanthord -H env XDG_RUNTIME_DIR=/run/kanthord podman ps --filter label=io.kanthord.owner`.

## Read the files of an instance

The server writes the output of each instance to `workers/<client_id>/stderr.log` of its state directory, for example `~/.local/state/kanthord/workers/<client_id>/stderr.log`. On the VPS, the state directory is `/var/lib/kanthord/.local/state/kanthord`.

The Conversation tab of the trace page of the dashboard shows the session entries of each execution. The pi session files also stay in the volume of the instance. To list the files of one execution:

```sh
podman run --rm -v kanthord_slot_<client_id>:/v:ro --entrypoint ls docker.io/kanthorlabs/kanthord:<version> /v/state/kanthord/pi/sessions/execution/<execution_id>
```

On the VPS, write `sudo -u kanthord -H env XDG_RUNTIME_DIR=/run/kanthord podman` in place of `podman`.

## Limits

- An instance reaches the network through the default network of the runtime. It cannot reach `127.0.0.1` of the host. A provider, an OAuth endpoint or an S3 endpoint on the host loopback address, for example a local Ollama or MinIO, fails at the `container` placement. Use the `server` placement for such a binding.
- An agent command still reaches the memory of its own instance and every network that the container reaches.
- An agent command at the `server` placement on the same server reaches every container of the server through the runtime. Do not mix `server` bindings of untrusted repositories with `container` bindings on one server.
- The server removes the volume `kanthord_slot_<client_id>` after you remove the binding and its last slot ends. A lowered count keeps the volume.

## Troubleshooting

| Symptom                                                                                     | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save binding** fails with `project.bindings.worker.placement_unavailable`                 | The server cannot run containers. `error.details.reason` names the cause: `server_in_container`, `runtime_absent` or `runtime_rootful`. The reason `runtime_failed` never refuses a save, because a stopped runtime recovers. See the rows below.                                                                                                                                                                                                                                                                                                                                            |
| The sheet shows "Off. This server runs in a container…", or `reason: server_in_container`   | The server runs in a container. Install the binary on the host, or keep the `server` placement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The sheet shows "Install Podman or Docker on the server host…", or `reason: runtime_absent` | No `podman` and no `docker` is on the `PATH` of the server. Do step 1, then restart the server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The sheet shows "Cannot connect to Podman…", or `reason: runtime_failed` with that text     | The Podman machine is stopped. Run `podman machine start`. The instances start by themselves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The sheet or `reason: runtime_failed` names the server user and the uid map                 | The user has no subordinate uid range that covers uid 10001 of the container. Do item 1 of [On a VPS with the service user](#on-a-vps-with-the-service-user).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The sheet shows "… runs as root on this host…", or `reason: runtime_rootful`                | The runtime runs as root on this Linux host. Use rootless Podman or rootless Docker. A Linux VM runtime other than Docker Desktop, for example Rancher Desktop, gets this refusal too. Use Podman there.                                                                                                                                                                                                                                                                                                                                                                                     |
| `reason: runtime_failed` stays while `podman machine list` shows a running machine          | The server runs with a custom `XDG_CONFIG_HOME` or `XDG_DATA_HOME`. The check runs with the full server environment and loses the Podman machine connection. Remove both variables from the server environment, then restart the server.                                                                                                                                                                                                                                                                                                                                                     |
| An instance never shows on the **Workers** page                                             | Read `workers/<client_id>/stderr.log`. A failed pull shows there. Pull the image as the user of the server, then wait for the next start of the instance. The server tries again after a pause of up to 30 s.                                                                                                                                                                                                                                                                                                                                                                                |
| An instance never starts, and `environment list` shows `status: failed`                     | The build or the proof of the environment failed. `failure` holds the class and the last output. Run `kanthord project environment show <project-id> <binding-id> --token '<human token>'` to read the source and the document. Fix the stored document with `kanthord project environment set`. Push a fix in the repository to the base branch. The server reads the commit of the base branch every 60 s and runs the environment again at a new commit. To force a run at the same commit, run `kanthord project environment rebuild <project-id> <binding-id> --token '<human token>'`. |
| A node fails with a provider or storage error that names `127.0.0.1` or `localhost`         | The endpoint is on the host loopback address. See [Limits](#limits).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| On a Mac, nodes fail at random during `npm ci`                                              | The Podman machine has too little memory. Set 8 GiB with the commands of [On a Mac with Podman](#on-a-mac-with-podman).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
