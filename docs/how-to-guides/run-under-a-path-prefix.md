# Run kanthord under a path prefix with Cloudflare Tunnel and nginx

[How-to guides](README.md)

Run the kanthord single binary on a home server, and reach it at `https://homelab.example.com/s/kanthord/`. Other services share the same domain, each under its own `/s/<service-name>/` path.

One tunnel route sends every request of the host to nginx. nginx routes each `/s/<service-name>/` path to its local service. The daemon serves its whole HTTP surface under `gateway.base_path`, so nginx forwards the full path unchanged.

## Before you start

- A Linux server with systemd, on `x86_64` or `arm64`.
- A domain on Cloudflare, for example `example.com`.
- A Cloudflare Tunnel that runs on the server as the `cloudflared` systemd service. The Cloudflare dashboard manages the routes of the tunnel.
- nginx on the server, with no other site on `127.0.0.1:80`.
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

## 4. Route the path with nginx

Write `/etc/nginx/sites-available/homelab`:

```nginx
server {
    listen 127.0.0.1:80;
    server_name homelab.example.com;

    location /s/kanthord {
        proxy_pass http://127.0.0.1:31415;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        return 404;
    }
}
```

- `proxy_pass` has no URI after the port, so nginx keeps the `/s/kanthord` prefix.
- `proxy_set_header Host $host` keeps the public host, so the allowlist of step 2 matches.
- `proxy_buffering off` lets a stream reach the browser at once.
- The daemon answers `/s/kanthord` with a 301 to `/s/kanthord/`, so nginx needs no redirect.

Enable the site and reload nginx:

```sh
sudo ln -s /etc/nginx/sites-available/homelab /etc/nginx/sites-enabled/homelab
sudo nginx -t
sudo systemctl reload nginx
curl -H 'Host: homelab.example.com' http://127.0.0.1/s/kanthord/api/liveness
```

To add another service, add a `location /s/<service-name>` block. A service that cannot serve under its prefix breaks behind a path.

## 5. Add the tunnel route

1. Open the Cloudflare dashboard, then go to **Networking** > **Tunnels**, and select the tunnel.
2. Under **Routes**, select **Add route** > **Published application**.
3. Under **Hostname**, set the subdomain to `homelab` and the domain to `example.com`. Leave the path empty.
4. Set **Service URL** to `http://127.0.0.1:80`.
5. Select **Add route**.

Cloudflare creates the DNS record of `homelab.example.com`. This one route serves every service, so a new service needs no new route.

## 6. Protect the host with Cloudflare Access

1. Go to **Zero Trust** > **Access** > **Applications** > **Add an application** > **Self-hosted**.
2. Set the domain to `homelab.example.com`, and leave the path empty. The application then covers every service on the host.
3. Add a policy with the action **Allow** and the rule **Emails** with your address.
4. Save the application.

A browser signs in to Access once, then reaches each service.

## 7. Get a token and sign in

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
| `404` from nginx                                     | No `location` block matches the path. Check `/etc/nginx/sites-available/homelab`.                                                                     |
| `502` from Cloudflare                                | nginx is not running. Read `sudo journalctl -u nginx`.                                                                                                |
| `502` from nginx                                     | The server is not running. Read `sudo journalctl -u kanthord`.                                                                                        |
| The CLI fails from another machine                   | Cloudflare Access asks for a browser sign-in. Use the CLI on the server, or reach the server through another path such as Tailscale.                  |
