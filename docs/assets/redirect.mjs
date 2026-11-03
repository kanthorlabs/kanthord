const sections = ["reference", "explanation", "tutorials", "how-to-guides"];

export function viewerTarget(search, hash) {
  const path = new URLSearchParams(search).get("p") ?? "";
  const valid =
    /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(path) &&
    (path === "README.md" || sections.includes(path.split("/")[0]));
  if (!valid) return "index.html";
  const page = /(^|\/)README\.md$/.test(path)
    ? path.replace(/README\.md$/, "index.html")
    : path.replace(/\.md$/, ".html");
  return page + hash;
}
