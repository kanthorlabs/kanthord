# Development

Daily dev actions. Everything is already set up. Run from the repo root.

## Once per boot

```sh
make machine-up        # start the Podman VM
```

## Pick a mode

| You want | Mode | Section |
|---|---|---|
| Core in the sandbox, client on your Mac | single container (host → TCP) | A |
| Core + client both in the sandbox over UDS | multi container | B |
| Real Core + web dashboard | dashboard compose stack | C |

## A. Single container (host client over TCP `127.0.0.1:7777`)

```sh
make up                # start Core (sandbox), background
make logs              # follow logs
make shell             # bash inside the container
make ps                # container status
make restart           # restart
make down              # stop + remove
make verify            # build, run, probe the .data/ boundary, tear down
```

## B. Multi container (server + client over UDS)

```sh
make compose-up        # build + start server and client
make compose-logs      # follow both services (client shows uds_ok ...)
make compose-down      # stop both, drop the socket volume
```

## Build

```sh
make build             # build the dev image
```

## C. Real Core + web dashboard

The stack copies source into its images. It does not mount the host source tree.
Core remains loopback-only inside the shared container network namespace, and
Vite proxies Connect RPCs so the browser uses one origin.

```sh
make dashboard-up      # build and start Core + Vite
make dashboard-logs    # follow both services
make dashboard-ps      # show service status
make dashboard-down    # stop and remove the stack
```

Open `http://127.0.0.1:5173`.

Defaults match the current live-proof setup. Override them when needed:

```sh
make dashboard-up \
  SLOT=/data/kanthord-auth/slots/my-slot.yaml \
  ACCOUNT=codex \
  MODEL=gpt-5.4-mini \
  WEB_PORT=5174
```

The slot, provider account, and identity credentials must already exist under
`.data/kanthord-auth/`. Secrets are read from that runtime mount and are never
baked into either image.

## Inspect data

Host-visible under `.data/`:

```sh
.data/database/        # file DB
.data/logs/            # operational logs (jsonl)
.data/auth/            # credential (0600), dir 0700
.data/cache/
```

The UDS socket is not on the host in mode B; reach it via `make shell`.

## Reset / clean

```sh
make reset             # stop container + wipe .data/ (DESTRUCTIVE)
make clean             # remove container + dev image
make machine-down      # stop the Podman VM
```

## Override the port

```sh
make up PORT=7800
make verify PORT=7800
```

## All targets

```sh
make help
```
