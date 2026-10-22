import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_TIME_LENGTH = 10;
const ULID_BASE = 32;
const IDEMPOTENCY_KEY_PREFIX = "idempotency_key";
const NOT_FOUND = 404;

export function ulid() {
  let time = Date.now();
  let head = "";
  for (let index = 0; index < ULID_TIME_LENGTH; index++) {
    head = ULID_ALPHABET[time % ULID_BASE] + head;
    time = Math.floor(time / ULID_BASE);
  }
  return (
    head +
    [...randomBytes(16)].map((byte) => ULID_ALPHABET[byte % ULID_BASE]).join("")
  );
}

export function tokenOf(cliFile) {
  const match = readFileSync(cliFile, "utf8").match(/^token: (.+)$/m);
  if (!match) throw new Error(`${cliFile} holds no token`);
  return match[1].trim();
}

export function readEnvFile(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

export function client(endpoint, token) {
  async function call(method, path, body) {
    const headers = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET")
      headers["idempotency-key"] = `${IDEMPOTENCY_KEY_PREFIX}_${ulid()}`;
    const response = await fetch(endpoint + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (response.status === NOT_FOUND && method === "GET") return null;
    if (!response.ok)
      throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    put: (path, body) => call("PUT", path, body),
  };
}

export function mainCheckout(root) {
  return dirname(
    execFileSync(
      "git",
      ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim(),
  );
}

export function checkoutCommand(args) {
  return `(cd engine && node src/main.ts ${args})`;
}
