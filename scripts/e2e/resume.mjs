import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { client, mainCheckout, tokenOf } from "./api.mjs";

const [run] = process.argv.slice(2);
if (!run) throw new Error("usage: resume.mjs <run>");
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const MAIN = mainCheckout(ROOT);
const runDir = join(MAIN, ".dev/e2e", run);
const state = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
const api = client(state.endpoint, tokenOf(join(runDir, "human.cli.yaml")));
const project = await api.post(`/api/project/${state.project_id}/resume`);
console.log(`e2e-resume: project ${project.id} active`);
