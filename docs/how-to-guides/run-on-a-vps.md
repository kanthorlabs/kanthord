# Run kanthord on a VPS

[How-to guides](README.md)

Run the kanthord single binary on a Linux server, and reach it through a domain with HTTPS. The binary contains the server, the CLI and the dashboard. It needs no Node.js.

The daemon listens on `127.0.0.1` only. Caddy terminates HTTPS on ports 80 and 443 and forwards each request to the daemon.

## Before you start

- A Linux server with systemd, on `x86_64` or `arm64`.
- A domain name, for example `kanthord.example.com`, with a DNS `A` or `AAAA` record that points to the server.
- The binary for the architecture of the server: `kanthord-linux-x64` or `kanthord-linux-arm64`. To build it, run `make release-build` on a Linux machine of the same architecture. The file is then in `dist/`.

## 1. Install the binary

```sh
sudo install -m 755 kanthord-linux-x64 /usr/local/bin/kanthord
kanthord --help
```

## 2. Create a service user

The server keeps its configuration and data in the home directory of the user that runs it.

```sh
sudo useradd --system --create-home --home-dir /var/lib/kanthord --shell /usr/sbin/nologin kanthord
sudo chmod 700 /var/lib/kanthord
```

## 3. Create the configuration

Add the domain to the host allowlist. The server refuses every request with a `Host` header outside this list.

```sh
sudo -u kanthord -H kanthord config init --allowed-host kanthord.example.com
```

The command writes `/var/lib/kanthord/.config/kanthord/kanthord.yaml`. See [config init](../reference/config/init.md).

## 4. Run the server with systemd

Write `/etc/systemd/system/kanthord.service`:

```ini
[Unit]
Description=kanthord
After=network-online.target
Wants=network-online.target

[Service]
User=kanthord
Group=kanthord
Environment=HOME=/var/lib/kanthord
ExecStart=/usr/local/bin/kanthord serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Start the server:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now kanthord
sudo journalctl -u kanthord -f
```

## 5. Put Caddy in front

Install Caddy from the [Caddy installation page](https://caddyserver.com/docs/install). Then replace `/etc/caddy/Caddyfile` with:

```caddy
kanthord.example.com {
	reverse_proxy 127.0.0.1:31415
}
```

Reload Caddy:

```sh
sudo systemctl reload caddy
```

Caddy gets a certificate for the domain and keeps the original `Host` header, so the allowlist of step 3 matches.

## 6. Open only the web ports

Allow ports 80 and 443 in the firewall. Keep port 31415 closed. The daemon listens on `127.0.0.1` only, so it cannot be reached from outside.

## 7. Get a token and sign in

```sh
sudo -u kanthord -H kanthord jwt generate <your username>
```

The command prints a human token on the terminal. See [jwt generate](../reference/jwt.md).

1. Open `https://kanthord.example.com`.
2. Keep the Endpoint value. The dashboard fills it with the address of the page.
3. Paste the token, then select **Login**.

To use the CLI from your own machine, set `KANTHORD_ENDPOINT=https://kanthord.example.com`.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403` with `gateway.http.host_not_allowed` | The domain is not in `gateway.allowed_hosts`. Add it to `/var/lib/kanthord/.config/kanthord/kanthord.yaml`, then run `sudo systemctl restart kanthord`. |
| `502` from Caddy                           | The server is not running. Read `sudo journalctl -u kanthord`.                                                                                          |
| No certificate                             | Make sure that the DNS record points to the server, and that ports 80 and 443 are open.                                                                 |
