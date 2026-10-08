import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [engineDir, dashboardDir, bundle, blob, output] = process.argv.slice(2);
if (!engineDir || !dashboardDir || !bundle || !blob || !output) {
  process.stderr.write(
    "usage: sea-config.mjs <engine dir> <dashboard dir> <bundle> <blob> <output>\n",
  );
  process.exit(1);
}

function addFiles(assets, directory, prefix) {
  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    assets[`${prefix}${relative(directory, path)}`] = path;
  }
}

const assets = { "package.json": join(engineDir, "package.json") };
addFiles(assets, join(engineDir, "static"), "");
addFiles(assets, dashboardDir, "dashboard/");

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
