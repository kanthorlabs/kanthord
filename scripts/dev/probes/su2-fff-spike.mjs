// su2-fff-spike — Epic 020 SU2 embedding spike for @ff-labs/fff-node.
//
// Characterizes the fff surface kanthord's Epic 023 wraps behind src/search/:
// index start/stop, path query, content query, glob, frecency, watcher
// lifecycle, non-git-dir behavior, memory footprint, and runtime engine version.
//
// Scratch-only: operates on throwaway temp dirs it creates and removes. No
// secrets involved. Exit 0 = PASS, non-zero = FAIL, 2 = probe error.
//
// Run native-on-Mac:   node scripts/dev/probes/su2-fff-spike.mjs
// Run in the container: podman cp + podman exec (see the SU2 findings file).

import { FileFinder } from "@ff-labs/fff-node";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A finder returns Result<T> = { ok, value } | { ok:false, error }. Unwrap or throw.
const unwrap = (r, what) => {
  if (!r || r.ok !== true) throw new Error(`${what} failed: ${r ? JSON.stringify(r.error) : "no result"}`);
  return r.value;
};

async function seedRepo(dir, { git }) {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "alpha.ts"), "export const alpha = 1;\n// TODO: MAGIC_TOKEN_ALPHA\n");
  await writeFile(join(dir, "src", "beta.ts"), "export const beta = 2;\n");
  await writeFile(join(dir, "README.md"), "# scratch\nMAGIC_TOKEN_ALPHA appears here too.\n");
  if (git) {
    execFileSync("git", ["init", "-q", dir], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "add", "."], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "-c", "user.email=p@x", "-c", "user.name=p", "commit", "-qm", "seed"], { stdio: "pipe" });
  }
}

async function main() {
  // The package blocks the ./package.json subpath export, so read the manifest by
  // file path: resolve the ESM entry, then walk up to the package root.
  const entry = fileURLToPath(import.meta.resolve("@ff-labs/fff-node"));
  const pkgRoot = entry.slice(0, entry.indexOf("/dist/"));
  const pkgVersion = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8")).version;

  const gitDir = await mkdtemp(join(tmpdir(), "su2-fff-git-"));
  const plainDir = await mkdtemp(join(tmpdir(), "su2-fff-plain-"));
  const dbDir = await mkdtemp(join(tmpdir(), "su2-fff-db-"));
  let finder;

  try {
    await seedRepo(gitDir, { git: true });
    await seedRepo(plainDir, { git: false });

    const rssBefore = process.memoryUsage().rss;

    // 1. Index start — create + waitForScan on a git dir, with frecency enabled.
    const created = FileFinder.create({
      basePath: gitDir,
      frecencyDbPath: join(dbDir, "frecency.mdb"),
      historyDbPath: join(dbDir, "history.mdb"),
      aiMode: true,
    });
    finder = unwrap(created, "create");
    const scanned = unwrap(await finder.waitForScan(10_000), "waitForScan");
    record("index start (create + waitForScan on git dir)", scanned === true, `scanned=${scanned}`);

    // 2. Path query (fileSearch) — typo-resistant fuzzy path match.
    const fs1 = unwrap(finder.fileSearch("alfa", { pageSize: 10 }), "fileSearch");
    const foundAlpha = fs1.items.some((i) => i.relativePath.endsWith("alpha.ts"));
    record("path query fileSearch('alfa' typo → alpha.ts)", foundAlpha, `hits=${fs1.items.length}, totalMatched=${fs1.totalMatched}`);

    // 3. Content query (grep) — find a literal token across files.
    const gr = unwrap(finder.grep("MAGIC_TOKEN_ALPHA", { mode: "plain", smartCase: true }), "grep");
    const grepFiles = new Set(gr.items.map((m) => m.relativePath));
    record("content query grep('MAGIC_TOKEN_ALPHA')", gr.items.length >= 2, `matches=${gr.items.length}, files=${grepFiles.size}`);

    // 4. Glob.
    const gl = unwrap(finder.glob("**/*.ts", { pageSize: 50 }), "glob");
    record("glob('**/*.ts')", gl.items.length >= 2, `hits=${gl.items.length}`);

    // 5. Frecency — trackQuery a selection, then confirm ordering is influenced.
    let frecencyDetail = "n/a";
    try {
      // trackQuery canonicalizes the selected path → must be absolute (finding).
      unwrap(finder.trackQuery("beta", join(gitDir, "src", "beta.ts")), "trackQuery");
      const fs2 = unwrap(finder.fileSearch("beta", { pageSize: 10 }), "fileSearch(after track)");
      frecencyDetail = `top=${fs2.items[0]?.relativePath ?? "none"}`;
      record("frecency (trackQuery accepted; ranked search returns)", fs2.items.length >= 1, frecencyDetail);
    } catch (e) {
      record("frecency (trackQuery accepted; ranked search returns)", false, String(e.message));
    }

    // 6. Watcher lifecycle — add a file AFTER scan; does it appear (auto-watch)
    //    or only after an explicit reindex/scanFiles? Record the real behavior.
    await writeFile(join(gitDir, "src", "gamma.ts"), "export const gamma = 3;\n");
    await sleep(1500);
    let autoWatch = false;
    try {
      const w1 = unwrap(finder.fileSearch("gamma", { pageSize: 10 }), "fileSearch(watch auto)");
      autoWatch = w1.items.some((i) => i.relativePath.endsWith("gamma.ts"));
    } catch { /* ignore */ }
    let afterRescan = autoWatch;
    if (!autoWatch) {
      try {
        finder.scanFiles();
        await finder.waitForScan(5000);
        const w2 = unwrap(finder.fileSearch("gamma", { pageSize: 10 }), "fileSearch(after scanFiles)");
        afterRescan = w2.items.some((i) => i.relativePath.endsWith("gamma.ts"));
      } catch { /* ignore */ }
    }
    record("watcher (new file picked up)", autoWatch || afterRescan, `auto-watch=${autoWatch}, after-scanFiles=${afterRescan}`);

    // 7. Runtime engine version — healthCheck().version must equal the pinned pkg version.
    const hc = unwrap(finder.healthCheck(), "healthCheck");
    record("runtime engineVersion == pinned package version", hc.version === pkgVersion, `runtime=${hc.version}, pinned=${pkgVersion}, git2=${hc.git?.available}`);

    // 8. Non-git dir behavior — create + scan + query on a plain (non-git) dir.
    const plainCreated = FileFinder.create({ basePath: plainDir, aiMode: true });
    let plainOk = false, plainDetail = "";
    if (plainCreated.ok) {
      const pf = plainCreated.value;
      try {
        const s = unwrap(await pf.waitForScan(10_000), "waitForScan(plain)");
        const pr = unwrap(pf.fileSearch("alpha", { pageSize: 10 }), "fileSearch(plain)");
        plainOk = pr.items.some((i) => i.relativePath.endsWith("alpha.ts"));
        plainDetail = `scanned=${s}, hits=${pr.items.length} (fff itself does NOT require git; kanthord rejects non-git at registration)`;
      } finally { pf.destroy(); }
    } else {
      plainDetail = `create failed: ${JSON.stringify(plainCreated.error)}`;
    }
    record("non-git dir (fff indexes + queries a plain dir)", plainOk, plainDetail);

    // 9. Memory footprint after a full index on a tiny repo.
    const rssAfter = process.memoryUsage().rss;
    const deltaMb = ((rssAfter - rssBefore) / 1048576).toFixed(1);
    record("memory footprint recorded", true, `rss delta ≈ ${deltaMb} MB on a ~4-file repo (indicative only)`);

    // 10. Index stop.
    finder.destroy();
    finder = undefined;
    record("index stop (destroy)", true, "");

    const pass = results.filter((r) => r.ok).length;
    console.log(`\nRESULT: ${pass === results.length ? "PASS" : "FAIL"} — ${pass}/${results.length}  (platform=${process.platform}/${process.arch}, fff-node=${pkgVersion})`);
    process.exit(pass === results.length ? 0 : 1);
  } finally {
    try { finder?.destroy(); } catch { /* ignore */ }
    await rm(gitDir, { recursive: true, force: true });
    await rm(plainDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack || e);
  process.exit(2);
});
