# Add a toolchain to the worker image

[How-to guides](README.md)

Build an image that adds a toolchain, for example Node.js, to the kanthord image. The agent commands and the verifications of a node then find `node` and `npm`.

The kanthord image holds `bash`, `git`, the OpenSSH client and `kanthord`. It holds no language toolchain. A verification such as `npm test` fails in it.

Use the new image in one of two places:

- As the image of the server container of [Run kanthord in a container](run-in-a-container.md). Worker bindings at the `server` placement then run their commands with the toolchain.
- As `worker.container_image` of a server that runs worker instances at the `container` placement. See [Isolate worker instances in containers](isolate-worker-instances-in-containers.md).

## Before you start

- Podman or Docker on the host that builds the image. The commands use Podman. With Docker, write `docker` in place of `podman`.
- The kanthord version of the server, for example `28.0.1`: the tag of the server image, or the release of the server binary.

## 1. Write the Containerfile

Make an empty directory, and write this file as `Containerfile` in it:

```Containerfile
ARG NODE_VERSION=24.15.0
ARG VERSION

FROM docker.io/library/node:${NODE_VERSION}-trixie-slim AS node

FROM docker.io/kanthorlabs/kanthord:${VERSION}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
USER root
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
USER kanthord
```

The file starts from the kanthord image of your version, so the image keeps the `kanthord` binary, the user `kanthord` and its home `/var/lib/kanthord`. The last line makes `kanthord` the user again.

For another toolchain, add its packages in the same way. Run each install step as `root`, and end with `USER kanthord`.

## 2. Build the image

In that directory, write your kanthord version in place of `<version>`:

```sh
podman build --build-arg VERSION=<version> -t localhost/kanthord-node:<version> .
```

The tag of the new image must be the kanthord version. The server finds the image by that tag.

Check the toolchain:

```sh
podman run --rm --entrypoint node localhost/kanthord-node:<version> --version
```

The command prints the Node.js version, for example `v24.15.0`.

## 3. Use the image for the server container

1. Remove the server container. The volume keeps the configuration and the data.

   ```sh
   podman rm -f kanthord
   ```

2. Run the command of [step 3 of Run kanthord in a container](run-in-a-container.md#3-start-the-server) again. Write `localhost/kanthord-node:<version>` in place of `docker.io/kanthorlabs/kanthord:<version>`.

## 4. Use the image at the `container` placement

1. In the configuration file of the server, set the image name in the `worker` section. The file is `~/.config/kanthord/kanthord.yaml` on a Mac, and `/var/lib/kanthord/.config/kanthord/kanthord.yaml` on the VPS. Write no tag:

   ```yaml
   worker:
     container_image: localhost/kanthord-node
   ```

2. Run `kanthord config validate`, then restart the server. On the VPS, run `sudo -u kanthord -H kanthord config validate`, then `sudo systemctl restart kanthord`.

The server adds its own version as the tag, so it starts `localhost/kanthord-node:<version>`. A value with a tag or a digest fails with `system.config.invalid_field`.

Build the image as the same user that runs the server. Podman keeps one image store for each user. On the VPS, make the build directory under `/var/lib/kanthord`, so the user `kanthord` can read it. Then build:

```sh
sudo -u kanthord -H env XDG_RUNTIME_DIR=/run/kanthord podman build --build-arg VERSION=<version> -t localhost/kanthord-node:<version> <directory>
```

## After an upgrade

Build the image of the new version before you start the new server. Run step 2 with the new version. The configuration stays the same.

## Troubleshooting

| Symptom                                                                                          | Cause and fix                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `container` instance never registers, and `workers/<client_id>/stderr.log` shows a failed pull | The image of the server version is absent. Run step 2 with the version of the server, as the user that runs the server.                                                            |
| `kanthord config validate` fails with `system.config.invalid_field` on `worker.container_image`  | The value holds a tag or a digest. Remove the part after the last `:` of the name, or the part from `@`. A registry port such as `localhost:5000/kanthord-node` is valid.          |
| A verification still fails with `npm: command not found`                                         | The server runs another image. For the server container, run `podman inspect --format '{{.Config.Image}}' kanthord`. For the `container` placement, read `worker.container_image`. |
