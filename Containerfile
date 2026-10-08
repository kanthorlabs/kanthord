ARG NODE_VERSION=24.15.0

FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim AS build
ENV HUSKY=0
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY engine/package.json engine/pnpm-lock.yaml engine/pnpm-workspace.yaml engine/.npmrc engine/
COPY apps/package.json apps/pnpm-lock.yaml apps/pnpm-workspace.yaml apps/.npmrc apps/
RUN pnpm install --frozen-lockfile \
	&& pnpm --dir engine install --frozen-lockfile \
	&& pnpm --dir apps install --frozen-lockfile
COPY scripts/lib scripts/lib
COPY scripts/release scripts/release
COPY engine engine
COPY apps apps
RUN OUTPUT=/out/kanthord scripts/release/build.sh

FROM docker.io/library/debian:trixie-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bash ca-certificates fd-find git openssh-client ripgrep tini \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --uid 10001 --home-dir /var/lib/kanthord --create-home kanthord
COPY --from=build /out/kanthord /usr/local/bin/kanthord
USER kanthord
ENV HOME=/var/lib/kanthord \
	XDG_CONFIG_HOME=/var/lib/kanthord/config \
	XDG_DATA_HOME=/var/lib/kanthord/data \
	XDG_STATE_HOME=/var/lib/kanthord/state \
	XDG_CACHE_HOME=/var/lib/kanthord/cache
VOLUME /var/lib/kanthord
WORKDIR /var/lib/kanthord
EXPOSE 31415
ENTRYPOINT ["/usr/bin/tini", "--", "kanthord"]
CMD ["serve"]
