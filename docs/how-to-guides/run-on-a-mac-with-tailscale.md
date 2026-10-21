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
kanthord auth jwt generate <your username>
```

The command prints a human token on the terminal. See [auth jwt generate](../reference/auth/jwt.md).

## 7. Sign in from the phone

1. On the phone, open `https://<mac>.<tailnet>.ts.net`.
2. Keep the Endpoint value. The dashboard fills it with the address of the page.
3. Paste the token, then select **Login**.

## Run macOS nodes on this Mac

A node that needs macOS names the tag `platform.macos` in its `tags` list. Only a worker binding with that tag claims the node. The node needs a match in `Available` and in `Waiting`, so give the tag to a `coder@1` binding and to a `reviewer@1` binding.

1. Export the binding set of the project:

   ```sh
   kanthord project binding export <project-id> > bindings.json
   ```

2. In `bindings.json`, add `"tags": ["platform.macos"]` to the `config` of each worker binding whose instances run on this Mac.
3. Apply the binding set:

   ```sh
   kanthord project binding apply <project-id> --file bindings.json
   ```

4. In the plan file of each node that needs macOS, add `tags: [platform.macos]` to the front matter.
5. Import the plan. See [mission import](../reference/mission/import.md).

Apply the tags before the import. An import that adds a node that no worker binding of the project matches fails with `mission.node.tags_unmatched`. See [project bindings](../reference/project/binding.md).

## Run worker instances in containers

To run each worker instance in its own container on this Mac, see [Isolate worker instances in containers](isolate-worker-instances-in-containers.md).

## Run a worker on another host

A worker instance at the `worker` placement runs in a `kanthord serve worker` process on another Linux host or a Mac of your tailnet. It calls the server at `https://<mac>.<tailnet>.ts.net`. The server accepts the calls of a worker instance with any `Host` header, so the allowlist of step 3 needs no change.

1. On the worker host, check that the host is signed in to the tailnet of the server. On a Mac, set the alias of [2. Find the tailnet name of the Mac](#2-find-the-tailnet-name-of-the-mac) first.

   ```sh
   tailscale status
   ```

   The command prints one line for each device of the tailnet. One line holds `<mac>`, the Mac of the server.

2. On the Mac of the server, read the version of the server:

   ```sh
   kanthord --version
   ```

   The command prints the version, for example `28.0.1`.

3. Do steps 8.2 to 8.6 of [Run kanthord in a container](run-in-a-container.md#82-install-the-binary-on-the-worker-host) on the worker host. Skip step 1 of 8.2. In step 8.3, set **Address** to `https://<mac>.<tailnet>.ts.net`. The dashboard fills that value when you open the dashboard at that address.

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
