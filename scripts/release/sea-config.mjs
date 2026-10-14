import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [engineDir, dashboardDir, bundle, workerThreadBundle, blob, output] =
  process.argv.slice(2);
if (
  !engineDir ||
  !dashboardDir ||
  !bundle ||
  !workerThreadBundle ||
  !blob ||
  !output
) {
  process.stderr.write(
    "usage: sea-config.mjs <engine dir> <dashboard dir> <bundle> <worker-thread-bundle> <blob> <output>\n",
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

const piToolsDir = join(
  engineDir,
  ".pi-tools",
  `${process.platform}-${process.arch}`,
);
if (
  !existsSync(join(piToolsDir, "bin")) ||
  !existsSync(join(piToolsDir, "licenses"))
) {
  process.stderr.write(
    `the pi tools of ${process.platform}-${process.arch} are missing in ${piToolsDir}. Run pnpm run pi-tools:fetch in ${engineDir}\n`,
  );
  process.exit(1);
}

const assets = {
  "package.json": join(engineDir, "package.json"),
  "worker-thread.cjs": workerThreadBundle,
};
addFiles(assets, join(engineDir, "static"), "");
addFiles(assets, dashboardDir, "dashboard/");
addFiles(assets, join(piToolsDir, "bin"), "pi-tools/bin/");
addFiles(assets, join(piToolsDir, "licenses"), "pi-tools/licenses/");

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
