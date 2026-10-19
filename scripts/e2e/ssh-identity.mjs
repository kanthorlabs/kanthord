import { execFileSync } from "node:child_process";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SSH_ADDRESS_PATTERN = /^git@([A-Za-z0-9.-]+):/;

export function deployKeyTitle(run) {
  return `kanthord-e2e ${run}`;
}

export function sshHostOf(address) {
  const match = address.match(SSH_ADDRESS_PATTERN);
  if (!match) throw new Error(`${address} is not an SSH address git@<host>:`);
  return match[1];
}

export async function createSshKey(api, name) {
  const credential = await api.post("/api/repository/credential/ssh/key", {
    name,
  });
  const { public_key, fingerprint } = credential.revisions.at(-1).metadata;
  return { public_key, fingerprint };
}

export async function pinHostKey(api, host) {
  const scan = await api.post("/api/repository/host-key/scan", { host });
  return api.put(`/api/repository/host-key/${encodeURIComponent(host)}`, {
    fingerprint: scan.fingerprint,
  });
}

export function runGh(args, token) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_TOKEN: token },
  });
}

function requireAccess(repository, token) {
  if (!REPOSITORY_PATTERN.test(repository))
    throw new Error(`${repository} is not <owner>/<repository>`);
  if (!token) throw new Error("the GitHub token is empty");
}

export function addDeployKey(
  { repository, token, run, publicKey },
  gh = runGh,
) {
  requireAccess(repository, token);
  const id = gh(
    [
      "api",
      `repos/${repository}/keys`,
      "-f",
      `title=${deployKeyTitle(run)}`,
      "-f",
      `key=${publicKey}`,
      "-F",
      "read_only=false",
      "--jq",
      ".id",
    ],
    token,
  );
  return Number(id.trim());
}

export function deleteRunDeployKeys({ repository, token, run }, gh = runGh) {
  requireAccess(repository, token);
  const title = deployKeyTitle(run);
  const ids = gh(
    [
      "api",
      "--paginate",
      `repos/${repository}/keys`,
      "--jq",
      ".[] | [.id, .title] | @tsv",
    ],
    token,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([, keyTitle]) => keyTitle === title)
    .map(([id]) => Number(id));
  for (const id of ids)
    gh(["api", "-X", "DELETE", `repos/${repository}/keys/${id}`], token);
  return ids;
}
