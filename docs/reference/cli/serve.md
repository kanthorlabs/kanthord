# `kanthord serve [application]`

Start the server and keep it running until cancellation, a shutdown signal, or a fatal failure.

```sh
kanthord serve
kanthord serve server --config /absolute/path/kanthord.yaml
```

`server` is the default and only supported application. Server configuration follows the path precedence in [config init](config/init.md). Startup opens the operational log and SQLite store, applies migrations, and binds the listener. Startup issues no JWT and requires no terminal. Obtain human tokens explicitly with [kanthord jwt](jwt.md). The default listener is `127.0.0.1:31415`.

`SIGINT` and `SIGTERM` initiate graceful shutdown with a 10-second bound. Shutdown stops admission, cancels waiting work and streams, drains in-flight work, and releases server resources. `SIGHUP` reopens the log; reopen failure initiates shutdown. A clean run exits `0`; failure exits `1`.

Related: [healthcheck API](../api/gateway/healthcheck.md). [Reference index](../README.md).
