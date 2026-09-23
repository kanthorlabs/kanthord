// Paths are relative to the public site root, including on a project Pages URL.
const sections = ["reference", "explanation", "tutorials", "how-to-guides"];
const maxPathLength = 512;

export function validatePath(path) {
  if (typeof path !== "string" || path.length > maxPathLength) return null;
  if (path === "README.md") return path;
  if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(path)) return null;
  if (!sections.includes(path.split("/")[0])) return null;
  return path;
}

export function resolveMarkdownLink(href, currentPath) {
  if (!validatePath(currentPath))
    throw new Error("Invalid current document path");
  if (typeof href !== "string") throw new TypeError("Link must be a string");
  if (!/^[^?#]+\.md(?:#[^?]*)?$/.test(href)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || /[\\%]/.test(href)) return null;

  const root = new URL("https://docs.invalid/site/");
  const target = new URL(href, new URL(currentPath, root));
  if (
    target.origin !== root.origin ||
    !target.pathname.startsWith(root.pathname)
  )
    return null;
  const path = validatePath(target.pathname.slice(root.pathname.length));
  if (!path) return null;
  return "viewer.html?p=" + encodeURIComponent(path) + target.hash;
}
