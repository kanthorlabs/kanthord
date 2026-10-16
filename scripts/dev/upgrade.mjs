import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["src/main.ts", "upgrade"], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
