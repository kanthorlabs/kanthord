import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [engineDir, bundle, blob, output] = process.argv.slice(2);
if (!engineDir || !bundle || !blob || !output) {
  process.stderr.write(
    "usage: sea-config.mjs <engine dir> <bundle> <blob> <output>\n",
  );
  process.exit(1);
}

const staticDir = join(engineDir, "static");
const assets = { "package.json": join(engineDir, "package.json") };
for (const entry of readdirSync(staticDir, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  assets[relative(staticDir, path)] = path;
}

writeFileSync(
  output,
  `${JSON.stringify(
    {
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      assets,
    },
    null,
    2,
  )}\n`,
);
