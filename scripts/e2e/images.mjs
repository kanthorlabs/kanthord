import { execFileSync } from "node:child_process";
import { join } from "node:path";

const IMAGE_ID_LINE = /^image_id (\S+)$/m;

function runImages(root, mode, exec) {
  const output = exec(join(root, "scripts/e2e/images.sh"), [mode], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const match = String(output).match(IMAGE_ID_LINE);
  if (!match) throw new Error(`images.sh ${mode} printed no image_id line`);
  return match[1];
}

export function buildDevImages(root, exec = execFileSync) {
  return runImages(root, "build", exec);
}

export function currentImageId(root, exec = execFileSync) {
  return runImages(root, "id", exec);
}

export function imageIdField(placement, root, exec = execFileSync) {
  return placement === "container"
    ? { image_id: currentImageId(root, exec) }
    : {};
}
