ARG NODE_VERSION=24.15.0
ARG BASE_IMAGE=localhost/kanthord-dev
ARG VERSION

FROM docker.io/library/node:${NODE_VERSION}-trixie-slim AS node

FROM ${BASE_IMAGE}:${VERSION}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
USER root
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
USER kanthord
