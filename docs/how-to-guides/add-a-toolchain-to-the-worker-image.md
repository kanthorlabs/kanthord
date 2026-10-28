# Add a toolchain to the worker image

[How-to guides](README.md)

Build an image that adds a toolchain, for example Node.js, to the kanthord image. The agent commands and the verifications of a node then find `node` and `npm`.

The kanthord image holds `bash`, `git`, the OpenSSH client and `kanthord`. It holds no language toolchain. A verification such as `npm test` fails in it.

Use the new image as the image of the server container of [Run kanthord in a container](run-in-a-container.md). Worker instances at the `server` placement then run their commands with the toolchain.

At the `container` placement, this image does not apply. Follow [step 4](#4-add-a-toolchain-at-the-container-placement) instead.

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

## 4. Add a toolchain at the `container` placement

At the `container` placement, the image of this guide does not apply. Each container runs the image of the [environment](https://github.com/kanthorlabs/kanthord-engine/blob/main/docs/cli/project.md#binding-environment) of its repository binding. You build no image. The server builds the environment image, and takes only `kanthord` and `tini` from `worker.container_image`.

The commands of this step use these placeholders:

- `<project-id>`: the **Identity** value under **Details** on the project page, for example `project_01M5…`.
- `<binding-id>`: the `id` of the repository binding that `kanthord project binding list <project-id> --kind repository --token '<human token>'` prints.
- `<human token>`: the token of [auth jwt generate](../reference/auth/jwt.md).

By default, KanthorD selects the toolchain from the repository at the head of the base branch:

- A repository with a manifest, such as `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml` or `build.gradle`, gets the `detected` environment. A repository with one stack gets the image of that stack. A repository with several stacks gets a base image with one feature for each stack. The document holds the dependency install command of each stack. Node.js gets it only with a lock file. Python gets it only with `uv.lock`, `poetry.lock` or `requirements.txt`.
- A repository with no manifest gets the `universal` environment. It holds Node.js 24, Python 3.12, Go 1.25 and Java 21, and installs no project dependency.

To use another toolchain, write a devcontainer document, for example:

```json
{
  "image": "mcr.microsoft.com/devcontainers/javascript-node:24-bookworm",
  "updateContentCommand": "npm ci",
  "customizations": {
    "kanthord": {
      "checks": ["node --version", "npm --version"]
    }
  }
}
```

The image needs `bash`, glibc, git 2.40 or later and OpenSSH 9.0 or later. The Debian bookworm images under `mcr.microsoft.com/devcontainers` hold them. An Alpine or a bullseye image fails with `image_invalid`. Then do one of these steps:

- Commit the document as `.devcontainer/devcontainer.json` to the base branch of the repository.
- Store the document in the repository binding. Run:

  ```sh
  kanthord project environment set <project-id> <binding-id> --file devcontainer.json --token '<human token>'
  ```

A stored document comes before the repository file, and the repository file comes before the `detected` environment.

The server then builds and proves the environment. Read the status of each repository binding:

```sh
kanthord project environment list <project-id> --token '<human token>'
```

Wait until `status` is `ready`. A container starts only on a `ready` environment, and no node of the repository starts before it. The status `failed` holds the cause in `failure`. See [Troubleshooting of Isolate worker instances in containers](isolate-worker-instances-in-containers.md#troubleshooting).

## After an upgrade

Build the image of the new version before you start the new server. Run step 2 with the new version. The configuration stays the same.

## Troubleshooting

| Symptom                                                  | Cause and fix                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A verification still fails with `npm: command not found` | The server runs another image. Run `podman inspect --format '{{.Config.Image}}' kanthord`. |
