import { readFileSync } from "node:fs";

export const CONTAINER_IMAGE = "localhost/kanthord-dev-node";
const SECTION_LINE = /^worker:\s*$/;
const TOP_LEVEL_LINE = /^\S/;
const KEY_LINE = /^\s+container_image:\s*(.*?)\s*$/;

export function workerContainerImage(configText) {
  let inWorker = false;
  for (const line of configText.split("\n")) {
    if (SECTION_LINE.test(line)) {
      inWorker = true;
      continue;
    }
    if (TOP_LEVEL_LINE.test(line)) inWorker = false;
    const match = inWorker ? line.match(KEY_LINE) : null;
    if (match) return match[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return null;
}

export function requireContainerImage(configText, configFile) {
  if (workerContainerImage(configText) === CONTAINER_IMAGE) return;
  throw new Error(
    `${configFile} lacks the dev image. Write this line under worker: and restart make dev:\n  container_image: ${CONTAINER_IMAGE}`,
  );
}

export function requireContainerImageFile(configFile) {
  requireContainerImage(readFileSync(configFile, "utf8"), configFile);
}
