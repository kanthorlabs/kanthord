# Kanthor Core — local development sandbox image (Podman, rootless).
#
# Why this exists: D9 / HARD RULE — local dev runs Core inside Podman so the
# agent's tools (shell/filesystem) can damage only the container, never the host.
# The ONLY host path mounted at runtime is .data/ (UDS socket + file DB); the
# source is COPYed into the image, NOT bind-mounted, so the sandbox holds.
#
# Base: Node 24 (matches the runtime target in 01-plan.md §3). slim = Debian,
# best native/tooling compatibility; D2 means no .node modules so musl/alpine
# would also work, but slim keeps parity with the VPS image later.
FROM docker.io/library/node:24-slim

# Data volume boundary (01-plan.md §5). Mounted from the host at runtime.
ENV DATA_DIR=/data \
    PORT=7777 \
    NODE_ENV=development
ENV SOCK=${DATA_DIR}/sockets/smoke.sock

WORKDIR /app

# --- Real Core build goes here once packages exist -------------------------
# COPY package.json package-lock.json ./
# RUN npm ci
# COPY . .
# RUN npm run build
# CMD ["node", "apps/daemon/dist/server.js"]   # kanthord entrypoint
# ---------------------------------------------------------------------------

# Until Core exists, the image runs the boundary smoke harness so `make verify`
# can prove the .data/ mount, UDS, TCP, atomic write, and perms work today.
# smoke.mjs = server stand-in; uds-client.mjs = client stand-in (compose.yaml).
COPY scripts/dev/smoke.mjs scripts/dev/uds-client.mjs ./scripts/dev/

EXPOSE 7777
CMD ["node", "scripts/dev/smoke.mjs"]
