/** The UI walking skeleton: fetches /healthz and renders the version. */
export const UI_SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>kanthord</title>
</head>
<body>
<pre id="health">loading…</pre>
<script>
fetch("/healthz", { credentials: "same-origin", headers: { accept: "application/json" } })
  .then((res) => res.json())
  .then((body) => {
    document.getElementById("health").textContent = body.data.version;
  })
  .catch((err) => {
    document.getElementById("health").textContent = String(err);
  });
</script>
</body>
</html>
`;

export function uiShell(): string {
  return UI_SHELL_HTML;
}
