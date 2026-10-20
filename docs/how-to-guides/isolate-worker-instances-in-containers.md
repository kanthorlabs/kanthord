# Isolate worker instances in containers

[How-to guides](README.md)

Run the instances of a worker binding at the `container` placement. The server then starts one container for each instance on its own host, with Podman or Docker.

At the `server` placement, an agent command runs as the server user. It can read every credential of the server, `master_key` and the database. At the `container` placement, an agent command runs in the container of its instance. It reads no file of the server and cannot signal the server process. Each instance keeps its state in its own volume `kanthord_slot_<client_id>`.

The server must run as the kanthord binary on the host. A server inside a container cannot start containers, so `container` is off there. To install the binary, use [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md) or [Run kanthord on a VPS](run-on-a-vps.md).

## Before you start

- The kanthord server binary, installed and started on the host.
- One container runtime on the same host, for the user that runs the server:
  - On a Mac: a Podman machine or Docker Desktop.
  - On Linux: rootless Podman or rootless Docker. The server refuses a rootful runtime when the server user is not root.
- The image of the server version. The default is `docker.io/kanthorlabs/kanthord:<version>`. For a toolchain such as Node.js, build an image with [Add a toolchain to the worker image](add-a-toolchain-to-the-worker-image.md).

Replace each placeholder with your value:

| Placeholder      | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `<version>`      | The version of the server, for example `28.0.1`.                         |
| `<project id>`   | The **Identity** value on the project page, for example `project_01M5…`. |
| `<client_id>`    | The `client_id` of an instance on the **Workers** page.                  |
| `<execution_id>` | The identity of an execution, for example `execution_01M5…`.             |

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

### On a VPS with the service user

The service user `kanthord` of [Run kanthord on a VPS](run-on-a-vps.md) is a system user. It has no subordinate uid range and no user session. Give it both:

1. Install Podman and the uid map tools, and give the user a subordinate range:

   ```sh
   sudo apt install podman uidmap
   sudo usermod --add-subuids 200000-265535 --add-subgids 200000-265535 kanthord
   ```

2. Write `/var/lib/kanthord/.config/containers/containers.conf` as the user `kanthord`:

   ```sh
   sudo -u kanthord -H mkdir -p /var/lib/kanthord/.config/containers
   printf '[engine]\ncgroup_manager = "cgroupfs"\nevents_logger = "file"\n' | sudo -u kanthord -H tee /var/lib/kanthord/.config/containers/containers.conf
   ```

3. Add these lines to the `[Service]` section of `/etc/systemd/system/kanthord.service`:

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

## 2. Pull the image

Pull the image as the user that runs the server. The first start of an instance pulls it too, but that pull can take minutes.

```sh
podman pull docker.io/kanthorlabs/kanthord:<version>
```

On the VPS, run `sudo -u kanthord -H podman pull docker.io/kanthorlabs/kanthord:<version>`.

With a toolchain image, the server uses `worker.container_image` in place of `docker.io/kanthorlabs/kanthord`. Pull or build that image instead.

## 3. Check the placement

```sh
kanthord worker placement list
```

The `container` row shows `available: true` and the runtime, for example `container_runtime: podman`. A row with `available: false` shows a `reason`. See [Troubleshooting](#troubleshooting).

## 4. Add the worker binding

1. In the project, open the **Bindings** tab. Select **Add** in the **Workers** section.
2. Enter a **Name**, for example `coder-box`. Use a name that the project does not hold.
3. Choose the **Worker**, for example `coder@1`.
4. Choose the **Placement** `container`, and set the **Instance count**.
5. Select **Save binding**.

A later write cannot change the placement of a binding. To move an existing binding, follow [Move a server binding to the worker placement](run-in-a-container.md#move-a-server-binding-to-the-worker-placement), and choose `container` in place of `worker`.

The **Workers** page shows each instance with `· container`. The runtime lists the containers of the server:

```sh
podman ps --filter label=io.kanthord.owner
```

## Read the files of an instance

The server writes the output of each instance to `workers/<client_id>/stderr.log` of its state directory, for example `~/.local/state/kanthord/workers/<client_id>/stderr.log`. On the VPS, the state directory is `/var/lib/kanthord/.local/state/kanthord`.

The transcripts stay in the volume of the instance. To read one:

```sh
podman run --rm -v kanthord_slot_<client_id>:/v:ro --entrypoint cat docker.io/kanthorlabs/kanthord:<version> /v/state/kanthord/transcripts/<execution_id>.jsonl
```

## Limits

- An instance reaches the network through the default network of the runtime. It cannot reach `127.0.0.1` of the host. A provider, an OAuth endpoint or an S3 endpoint on the host loopback address, for example a local Ollama or MinIO, fails at the `container` placement. Use the `server` placement for such a binding.
- An agent command still reaches the memory of its own instance and every network that the container reaches.
- An agent command at the `server` placement on the same server reaches every container of the server through the runtime. Do not mix `server` bindings of untrusted repositories with `container` bindings on one server.
- The volume `kanthord_slot_<client_id>` stays after you remove the binding. Remove it with `podman volume rm kanthord_slot_<client_id>` when the binding is gone.

## Troubleshooting

| Symptom                                                                             | Cause and fix                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Save binding** fails with `project.bindings.worker.placement_unavailable`         | The server cannot run containers. `error.details.reason` names the cause. See the rows below.                                                                                                                 |
| `reason: server_in_container`                                                       | The server runs in a container. Install the binary on the host, or keep the `server` placement.                                                                                                               |
| `reason: runtime_absent`                                                            | No `podman` and no `docker` is on the `PATH` of the server. Do step 1, then restart the server.                                                                                                               |
| `reason: runtime_failed` with "Cannot connect to Podman"                            | The Podman machine is stopped. Run `podman machine start`. The instances start by themselves.                                                                                                                 |
| `reason: runtime_failed` that names the server user and the uid map                 | The user has no subordinate uid range that covers uid 10001 of the container. Do item 1 of [On a VPS with the service user](#on-a-vps-with-the-service-user).                                                 |
| `reason: runtime_rootful`                                                           | Docker runs as root on this Linux host. Use rootless Podman or rootless Docker. A Linux VM runtime other than Docker Desktop, for example Rancher Desktop, gets this refusal too. Use Podman there.           |
| An instance never shows on the **Workers** page                                     | Read `workers/<client_id>/stderr.log`. A failed pull shows there. Pull the image as the user of the server, then wait for the next start of the instance. The server tries again after a pause of up to 30 s. |
| A node fails with a provider or storage error that names `127.0.0.1` or `localhost` | The endpoint is on the host loopback address. See [Limits](#limits).                                                                                                                                          |
| On a Mac, nodes fail at random during `npm ci`                                      | The Podman machine has too little memory. Set 8 GiB with step 1.                                                                                                                                              |
