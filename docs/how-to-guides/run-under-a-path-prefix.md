# Run kanthord under a path prefix

[How-to guides](README.md)

Run the kanthord single binary behind a reverse proxy, and reach it under a path such as `https://proxy.example.com/s/kanthord/`. Other services can share the same host, each under its own path.

The daemon serves its whole HTTP surface under `gateway.base_path`: the API, the dashboard and its assets. The proxy forwards the full path unchanged, so the proxy needs no rewrite and no custom header.

- [Generic setup](#generic-setup) works with any reverse proxy.
- [Homelab with Cloudflare Tunnel and nginx](#homelab-with-cloudflare-tunnel-and-nginx) applies the generic setup to a home server.

## Generic setup

### Before you start

- A Linux server with systemd, on `x86_64` or `arm64`.
- The binary for the architecture of the server. See [Run kanthord on a VPS](run-on-a-vps.md#1-install-the-binary).
- A reverse proxy that terminates HTTPS for the public host, for example `proxy.example.com`.

### 1. Install the binary and create a service user

Do steps 1 and 2 of [Run kanthord on a VPS](run-on-a-vps.md).

### 2. Create the configuration

Add the public host to the host allowlist, and set the base path:

```sh
sudo -u kanthord -H kanthord config init \
  --gateway-allowed-host proxy.example.com \
  --gateway-base-path /s/kanthord
```

The base path is `/` or one or more segments, each after a `/`, with no trailing slash. The daemon then answers only under `/s/kanthord`. See [config init](../reference/config/init.md).

### 3. Run the server with systemd

Do step 4 of [Run kanthord on a VPS](run-on-a-vps.md#4-run-the-server-with-systemd).

Check the server on the machine:

```sh
curl -H 'Host: proxy.example.com' http://127.0.0.1:31415/s/kanthord/api/liveness
```

### 4. Configure the reverse proxy

Route the base path and every path under it to `http://127.0.0.1:31415`. The proxy must meet these rules:

- Forward the full path unchanged. Do not remove the `/s/kanthord` prefix.
- Forward the original `Host` header, so that the allowlist of step 2 matches.
- Do not buffer a response, so that a stream reaches the client at once.
- Allow a response time of at least 300 seconds.

The daemon answers `/s/kanthord` with a 301 to `/s/kanthord/`, so the proxy needs no redirect.

### 5. Get a token and sign in

```sh
sudo -u kanthord -H kanthord jwt generate <your username>
```

1. Open `https://proxy.example.com/s/kanthord/`.
2. Keep the Endpoint value. The dashboard fills it with `https://proxy.example.com/s/kanthord`.
3. Paste the token, then select **Login**.

Every client endpoint carries the prefix. On the server, set `KANTHORD_ENDPOINT=http://127.0.0.1:31415/s/kanthord` for the CLI.

### Troubleshooting

| Symptom                                              | Cause and fix                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403` with `gateway.http.host_not_allowed`           | The host is not in `gateway.allowed_hosts`. Add it to `/var/lib/kanthord/.config/kanthord/kanthord.yaml`, then run `sudo systemctl restart kanthord`. |
| `404` with `gateway.routing.not_found` on `/api/...` | The endpoint or the proxy drops the prefix. Add `/s/kanthord` to the endpoint, and make the proxy forward the full path.                              |
| `502` from the proxy                                 | The server is not running. Read `sudo journalctl -u kanthord`.                                                                                        |

## Homelab with Cloudflare Tunnel and nginx

Reach kanthord at `https://homelab.example.com/s/kanthord/` from a home server with no open router port. One tunnel route sends every request of the host to nginx. nginx routes each `/s/<service-name>` path to its local service, so a new service needs no new tunnel route.

### Before you start

- A domain on Cloudflare, for example `example.com`.
- A Cloudflare Tunnel that runs on the server as the `cloudflared` systemd service. The Cloudflare dashboard manages the routes of the tunnel.
- nginx on the server, with no other site on `127.0.0.1:80`.

### 1. Install and configure kanthord

Do steps 1 to 3 of the [generic setup](#generic-setup), with `homelab.example.com` as the public host.

### 2. Route the path with nginx

Write `/etc/nginx/sites-available/homelab`:

```nginx
limit_req_zone $binary_remote_addr zone=kanthord:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=kanthord_conn:10m;

server {
    listen 127.0.0.1:80;
    server_name homelab.example.com;

    set_real_ip_from 127.0.0.1;
    real_ip_header CF-Connecting-IP;

    absolute_redirect off;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    root /var/www/html;
    index index.html index.htm index.nginx-debian.html;

    location = /s/kanthord {
        return 301 /s/kanthord/;
    }

    location ^~ /s/kanthord/ {
        limit_req zone=kanthord burst=40 nodelay;
        limit_conn kanthord_conn 20;
        limit_req_status 429;
        limit_conn_status 429;
        client_max_body_size 50m;

        proxy_pass http://127.0.0.1:31415;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location ~ /\. {
        deny all;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

- `proxy_pass` has no URI after the port, so nginx keeps the `/s/kanthord` prefix.
- `listen 127.0.0.1:80` keeps nginx off the local network. Only `cloudflared` reaches it.
- `real_ip_header CF-Connecting-IP` gives the logs and the limits the address of the client, not the address of `cloudflared`.
- `limit_req` and `limit_conn` answer `429` to a client that sends more than 10 requests per second after a burst of 40, or that holds more than 20 connections.
- `client_max_body_size 50m` matches the largest request body of the daemon.
- `absolute_redirect off` keeps a redirect relative, so the browser stays on HTTPS.
- The `add_header` lines stop framing and MIME sniffing, and keep the browser on HTTPS.
- `location ~ /\.` refuses a hidden file of the web root.

Enable the site and reload nginx:

```sh
sudo ln -s /etc/nginx/sites-available/homelab /etc/nginx/sites-enabled/homelab
sudo nginx -t
sudo systemctl reload nginx
curl -H 'Host: homelab.example.com' http://127.0.0.1/s/kanthord/api/liveness
```

To add another service, add a `location ^~ /s/<service-name>/` block. A service that cannot serve under its prefix breaks behind a path.

### 3. Add the tunnel route

1. Open the Cloudflare dashboard, then go to **Networking** > **Tunnels**, and select the tunnel.
2. Under **Routes**, select **Add route** > **Published application**.
3. Under **Hostname**, set the subdomain to `homelab` and the domain to `example.com`. Leave the path empty.
4. Set **Service URL** to `http://127.0.0.1:80`.
5. Select **Add route**.

Cloudflare creates the DNS record of `homelab.example.com`, and it terminates HTTPS.

### 4. Protect the host with Cloudflare Access

1. Go to **Zero Trust** > **Access** > **Applications** > **Add an application** > **Self-hosted**.
2. Set the domain to `homelab.example.com`, and leave the path empty. The application then covers every service on the host.
3. Add a policy with the action **Allow** and the rule **Emails** with your address.
4. Save the application.

### 5. Sign in

Do step 5 of the [generic setup](#generic-setup) with `https://homelab.example.com/s/kanthord/`. Sign in to Cloudflare Access before the dashboard opens.

### Troubleshooting

| Symptom                            | Cause and fix                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `404` from nginx                   | No `location` block matches the path. Check `/etc/nginx/sites-available/homelab`.                                                    |
| `502` from Cloudflare              | nginx is not running. Read `sudo journalctl -u nginx`.                                                                               |
| `502` from nginx                   | The server is not running. Read `sudo journalctl -u kanthord`.                                                                       |
| The CLI fails from another machine | Cloudflare Access asks for a browser sign-in. Use the CLI on the server, or reach the server through another path such as Tailscale. |
