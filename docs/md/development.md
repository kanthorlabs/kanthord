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
