import { requireContainerImageFile } from "./dev-config.mjs";

const [configFile] = process.argv.slice(2);
if (!configFile) throw new Error("usage: dev-config-check.mjs <config file>");
try {
  requireContainerImageFile(configFile);
} catch (error) {
  console.error(`e2e: ${error.message}`);
  process.exit(1);
}
