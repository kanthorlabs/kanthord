# How-to guides

[Documentation home](../README.md)

These pages answer “How do I do this task?” Each guide is a short sequence of steps for one goal.

- [Run kanthord in a container](run-in-a-container.md): pull the published container image, run it with Podman or Docker, and connect a first repository with a dashboard SSH key.
- [Run kanthord on a Mac with Tailscale](run-on-a-mac-with-tailscale.md): run the single binary on a Mac and open the dashboard from a phone or a tablet on your tailnet.
- [Run kanthord on a VPS](run-on-a-vps.md): run the single binary on a Linux server behind Caddy with a domain and HTTPS.
- [Run kanthord under a path prefix](run-under-a-path-prefix.md): run the single binary under a path such as `/s/kanthord` behind any reverse proxy, or on a home server with Cloudflare Tunnel and nginx.
- [Isolate worker instances in containers](isolate-worker-instances-in-containers.md): run each instance of a worker binding in its own container on the host of the single binary, so an agent command reads no file of the server.
- [Add a toolchain to the worker image](add-a-toolchain-to-the-worker-image.md): build an image with Node.js or another toolchain for the server container or for the `container` placement.

For the exact commands and options, see the [reference](../reference/README.md).
