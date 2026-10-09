# Run kanthord under a path prefix with Cloudflare Tunnel

[How-to guides](README.md)

Run the kanthord single binary on a home server, and reach it at `https://homelab.example.com/s/kanthord/`. Other services share the same domain, each under its own `/s/<service-name>/` path.

Cloudflare Tunnel forwards the full path unchanged. The daemon serves its whole HTTP surface under `gateway.base_path`, so the tunnel needs no rewrite and no custom header.

## Before you start

- A Linux server with systemd, on `x86_64` or `arm64`.
- A domain on Cloudflare, for example `example.com`.
- A Cloudflare Tunnel that runs on the server as the `cloudflared` systemd service. The Cloudflare dashboard manages the routes of the tunnel.
- The binary for the architecture of the server. See [Run kanthord on a VPS](run-on-a-vps.md#1-install-the-binary).

## 1. Install the binary and create a service user

Do steps 1 and 2 of [Run kanthord on a VPS](run-on-a-vps.md).

## 2. Create the configuration

Add the public host to the host allowlist, and set the base path:

```sh
sudo -u kanthord -H kanthord config init \
  --gateway-allowed-host homelab.example.com \
  --gateway-base-path /s/kanthord
```

The daemon then answers only under `/s/kanthord`. See [config init](../reference/config/init.md).

## 3. Run the server with systemd

Do step 4 of [Run kanthord on a VPS](run-on-a-vps.md#4-run-the-server-with-systemd).

Check the server on the machine:

```sh
curl -H 'Host: homelab.example.com' http://127.0.0.1:31415/s/kanthord/api/liveness
```

## 4. Add the tunnel route

1. Open the Cloudflare dashboard, then go to **Zero Trust** > **Networks** > **Tunnels**.
2. Select the tunnel, then select **Configure** > **Public Hostname** > **Add a public hostname**.
3. Set **Subdomain** to `homelab` and **Domain** to `example.com`.
4. Set **Path** to `^/s/kanthord(/|$)`. The field is a regular expression on the request path.
5. Set **Service** to `HTTP` and `127.0.0.1:31415`.
6. Save the hostname.

Cloudflare creates the DNS record of `homelab.example.com`. A request that matches no route answers 404 from the tunnel.

To add another service, add another public hostname with the same subdomain and its own path, for example `^/s/qbittorrent(/|$)`. That service must also serve under its prefix.

## 5. Protect the host with Cloudflare Access

1. Go to **Zero Trust** > **Access** > **Applications** > **Add an application** > **Self-hosted**.
2. Set the domain to `homelab.example.com`, and leave the path empty. The application then covers every service on the host.
3. Add a policy with the action **Allow** and the rule **Emails** with your address.
4. Save the application.

A browser signs in to Access once, then reaches each service.

## 6. Get a token and sign in

```sh
sudo -u kanthord -H kanthord jwt generate <your username>
```

1. Open `https://homelab.example.com/s/kanthord/`.
2. Sign in to Cloudflare Access.
3. Keep the Endpoint value. The dashboard fills it with `https://homelab.example.com/s/kanthord`.
4. Paste the token, then select **Login**.

On the server, set `KANTHORD_ENDPOINT=http://127.0.0.1:31415/s/kanthord` for the CLI.

## Troubleshooting

| Symptom                                              | Cause and fix                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403` with `gateway.http.host_not_allowed`           | The host is not in `gateway.allowed_hosts`. Add it to `/var/lib/kanthord/.config/kanthord/kanthord.yaml`, then run `sudo systemctl restart kanthord`. |
| `404` with `gateway.routing.not_found` on `/api/...` | The endpoint has no prefix. Add `/s/kanthord` to the endpoint.                                                                                        |
| `404` from Cloudflare                                | No tunnel route matches the path. Check the **Path** value of the public hostname.                                                                    |
| `502` from Cloudflare                                | The server is not running. Read `sudo journalctl -u kanthord`.                                                                                        |
| The CLI fails from another machine                   | Cloudflare Access asks for a browser sign-in. Use the CLI on the server, or reach the server through another path such as Tailscale.                  |
