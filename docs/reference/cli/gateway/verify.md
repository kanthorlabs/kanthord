# `kanthord gateway verify`

Call the [verification API](../../api/gateway/verify.md) and print the authenticated human identity.

```sh
kanthord gateway verify --token '<jwt>' --endpoint http://127.0.0.1:31415
kanthord gateway verify
```

The second form uses the resolved human token. Token precedence is `--token` → `KANTHORD_TOKEN` → operator-supplied `cli.yaml` token. Endpoint precedence is `--endpoint` → `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`. There is no login or credential-saving command. An optional manually supplied client file must have mode `0600`.

Success writes one JSON line such as `{"kind":"human","accountId":"ulrich"}` and exits `0`. A declared API failure exits `1` with its HTTP status in a diagnostic. A transport failure, timeout, or invalid response produces an indeterminate-result diagnostic and exits `1`. The HTTP client has an 11-second deadline for this 10-second operation. Missing credentials are submitted without an Authorization header and receive HTTP `401` from a ready server.

Related: [JWT generation](../jwt.md). [Reference index](../../README.md).
