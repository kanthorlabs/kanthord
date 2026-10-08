# Run kanthord on a Mac with Tailscale

[How-to guides](README.md)

Run the kanthord single binary on your Mac. Then open the dashboard from a phone or a tablet on your tailnet. The binary contains the server, the CLI and the dashboard. It needs no Node.js and no web server.

The daemon listens on `127.0.0.1` only. `tailscale serve` gives the daemon an HTTPS address that only your tailnet can reach.

## Before you start

- A Mac with Apple silicon.
- Tailscale installed and signed in on the Mac and on the phone or tablet.
- MagicDNS and HTTPS certificates turned on for your tailnet in the Tailscale admin console.
- The binary `kanthord-darwin-arm64` and `SHA256SUMS` from the [releases page](https://github.com/kanthorlabs/kanthord/releases). To build the binary from a checkout of this repository instead, run `make release-build`. The file is then in `dist/`.

## 1. Install the binary

If you downloaded the file, check it against `SHA256SUMS`:

```sh
shasum -a 256 --ignore-missing -c SHA256SUMS
```

Then remove the macOS quarantine flag. Otherwise macOS refuses to start it.

```sh
xattr -d com.apple.quarantine kanthord-darwin-arm64
```

Copy the binary to a directory on your `PATH`:

```sh
sudo install -m 755 kanthord-darwin-arm64 /usr/local/bin/kanthord
kanthord --help
```

## 2. Find the tailnet name of the Mac

The Tailscale app for macOS keeps its CLI inside the application bundle:

```sh
alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale
tailscale status --self --json | grep '"DNSName"'
```

The name has the form `<mac>.<tailnet>.ts.net`. Do not include the final dot.

## 3. Create the configuration

Add the tailnet name to the host allowlist. The server refuses every request with a `Host` header outside this list.

```sh
kanthord config init --gateway-allowed-host <mac>.<tailnet>.ts.net
```

The command writes `~/.config/kanthord/kanthord.yaml`. See [config init](../reference/config/init.md).

## 4. Start the server

```sh
kanthord serve
```

Keep this terminal open. The server listens on `http://127.0.0.1:31415`. Open `http://localhost:31415` on the Mac to see the dashboard.

## 5. Publish the server to your tailnet

In a second terminal:

```sh
tailscale serve --bg 31415
```

Tailscale now forwards `https://<mac>.<tailnet>.ts.net` to the server. The first request can take some seconds, because Tailscale gets the certificate.

## 6. Get a token

```sh
kanthord jwt generate <your username>
```

The command prints a human token on the terminal. See [jwt generate](../reference/jwt.md).

## 7. Sign in from the phone

1. On the phone, open `https://<mac>.<tailnet>.ts.net`.
2. Keep the Endpoint value. The dashboard fills it with the address of the page.
3. Paste the token, then select **Login**.

## Stop sharing the server

```sh
tailscale serve --https=443 off
```

Stop the server with `Ctrl-C` in its terminal.

## Troubleshooting

| Symptom                                     | Cause and fix                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `403` with `gateway.http.host_not_allowed`  | The tailnet name is not in `gateway.allowed_hosts`. Add it to `~/.config/kanthord/kanthord.yaml`, then restart the server. |
| macOS says that it cannot verify the binary | Run the `xattr` command of step 1.                                                                                         |
| The phone cannot open the address           | Make sure that Tailscale is connected on the phone, and that HTTPS certificates are turned on for the tailnet.             |
