/**
 * Suite-level no-network + no-external-credentials guard (Epic 010 Story 001 T1).
 *
 * MUST be the first import in every gate test — installed as a side-effect
 * before any SUT module is loaded.  Patches Node.js network primitives and
 * credential access so any non-loopback network use or provider-credential
 * read throws at call-site.
 *
 * Loopback exemption: 127.0.0.1 / ::1 / localhost are allowed (required by
 * the Epic 009 Connect transport tests).
 *
 * Implementation note — ESM namespace bindings in Node 24 capture a VALUE
 * SNAPSHOT at module link time, not a live getter.  Mutating a named export
 * on the CJS module.exports object AFTER import has no effect on the already-
 * bound ESM namespace entry.  Two techniques that ARE visible through ESM:
 *
 *   1. Prototype mutation — Socket.prototype.connect IS the same object
 *      whether obtained via require("net") or import * as net, because class
 *      prototypes are shared by reference.  All TCP-based connections go
 *      through Socket.prototype.connect synchronously, so a single prototype
 *      patch intercepts net, tls, http, https, and http2.
 *
 *   2. Nested-object property mutation — dns.promises is a shared object
 *      whose property reads are live, so mutating dns.promises[method] IS
 *      visible through import * as dns.  Similarly, require("fs").openSync is
 *      a shared exports property that readFileSync calls internally, so
 *      patching openSync intercepts readFileSync even when readFileSync was
 *      imported as an ESM named binding snapshot.
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, sep } from "node:path";

const _require = createRequire(import.meta.url);

type AnyFn = (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Loopback helpers
// ---------------------------------------------------------------------------

function isLoopback(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "::1" || bare === "localhost";
}

function guardHost(host: string | null | undefined, label: string): void {
  if (host != null && !isLoopback(host)) {
    throw new Error(`no external network: ${label} blocked (host: ${host})`);
  }
}

/**
 * Extract target hostname from Socket.prototype.connect / net.createConnection
 * argument styles: (options) or (port, host?, ...).
 */
function netHost(args: unknown[]): string | null {
  const first = args[0];
  if (typeof first === "number") {
    const h = args[1];
    return typeof h === "string" ? h : null;
  }
  if (typeof first === "object" && first !== null) {
    // normalized-args-array: net.createConnection / http.request pass args[0]
    // as an Array or array-like where args[0][0] holds the real options object
    if (0 in (first as object)) {
      const inner = (first as Record<number, unknown>)[0];
      if (typeof inner === "object" && inner !== null) {
        const o = inner as Record<string, unknown>;
        if (typeof o["host"] === "string") return o["host"];
        if (typeof o["hostname"] === "string") return o["hostname"];
      }
      return null;
    }
    const o = first as Record<string, unknown>;
    if (typeof o["host"] === "string") return o["host"];
    if (typeof o["hostname"] === "string") return o["hostname"];
    // path => Unix socket — allow
    return null;
  }
  // (path, cb?) => Unix socket string — allow
  return null;
}

// ---------------------------------------------------------------------------
// node:net / node:tls / node:http / node:https / node:http2
//
// All TCP-based connections (whether initiated via net.createConnection,
// tls.connect, http.request, https.request, or http2.connect) pass through
// Socket.prototype.connect synchronously during the initial call.  Patching
// the prototype is visible to code using the ESM import * namespace because
// the prototype object is shared by reference, unlike named export bindings
// which are value snapshots.
// ---------------------------------------------------------------------------

type NetSocketProto = { connect: AnyFn };
const NetSocket = (
  _require("net") as { Socket: { prototype: NetSocketProto } }
).Socket;

const _origSocketConnect = NetSocket.prototype.connect;
NetSocket.prototype.connect = function (
  this: NetSocketProto,
  ...args: unknown[]
): unknown {
  guardHost(netHost(args), "net.socket.connect");
  return _origSocketConnect.apply(this, args);
};

// ---------------------------------------------------------------------------
// node:dgram — block ALL UDP sockets (no loopback exemption for UDP).
//
// The dgram.Socket constructor sets this.type synchronously, making a setter
// on dgram.Socket.prototype an interception point that is called before any
// handle is bound.  Prototype mutation is visible across CJS / ESM imports
// for the same reason as Socket.prototype above.
// ---------------------------------------------------------------------------

type DgramSocketProto = Record<string, unknown>;
const dgramMod = _require("dgram") as {
  Socket: { prototype: DgramSocketProto };
};

Object.defineProperty(dgramMod.Socket.prototype, "type", {
  set(_v: unknown): void {
    throw new Error("no external network: dgram.createSocket blocked");
  },
  get(): unknown {
    return undefined;
  },
  configurable: true,
  enumerable: false,
});

// ---------------------------------------------------------------------------
// node:dns — block external DNS; throw synchronously before any I/O.
//
// dns.promises is a shared nested object — mutating its methods IS visible
// through import * as dns because the namespace binding holds the same object
// reference.
// ---------------------------------------------------------------------------

type DnsMod = { promises: Record<string, AnyFn | undefined> };
const dnsMod = _require("dns") as DnsMod;

for (const method of [
  "resolve4",
  "resolve6",
  "resolve",
  "resolveAny",
  "resolveMx",
  "resolveTxt",
  "resolveCname",
  "resolveNs",
  "lookup",
] as const) {
  const orig = dnsMod.promises[method];
  dnsMod.promises[method] = (...args: unknown[]) => {
    const host = typeof args[0] === "string" ? args[0] : null;
    if (host !== null && !isLoopback(host)) {
      throw new Error(
        `no external network: dns.promises.${method} blocked (host: ${host})`,
      );
    }
    return orig !== undefined ? orig(...args) : Promise.resolve(undefined);
  };
}

// ---------------------------------------------------------------------------
// globalThis.fetch — block non-loopback (throws synchronously before I/O).
// fetch is a global — mutation is always visible.
// ---------------------------------------------------------------------------

const _origFetch = globalThis.fetch;
globalThis.fetch = ((
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as { url: string }).url;
  let host: string | null = null;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    /* non-standard input */
  }
  guardHost(host, "fetch");
  return _origFetch(input, init);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// process.env — block direct reads of credential-shaped env var names.
//
// The ownKeys + getOwnPropertyDescriptor traps hide credential-named keys
// from enumeration so Node's child_process env-copy (Object.assign / for…in)
// never triggers the guard.  Only explicit keyed property access (user code
// reading process.env["SOME_TOKEN"]) fires the throw.
// ---------------------------------------------------------------------------

const CRED_SUFFIXES = ["_TOKEN", "_KEY", "_SECRET", "_PASSWORD"] as const;

function isCredKey(k: string): boolean {
  const u = k.toUpperCase();
  return CRED_SUFFIXES.some((sfx) => u.endsWith(sfx));
}

const _origEnv = process.env;
process.env = new Proxy(_origEnv, {
  get(target, prop, receiver) {
    if (typeof prop === "string" && isCredKey(prop)) {
      throw new Error(
        `no external credentials: env var "${prop}" access blocked`,
      );
    }
    return Reflect.get(target, prop, receiver);
  },
  ownKeys(target) {
    return Object.keys(target).filter((k) => !isCredKey(k));
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "string" && isCredKey(prop)) {
      return undefined;
    }
    return Object.getOwnPropertyDescriptor(target, prop);
  },
});

// ---------------------------------------------------------------------------
// node:fs readFileSync via openSync — block provider-credential file paths.
//
// readFileSync calls require("fs").openSync internally (via the shared exports
// object), so patching openSync is visible even when readFileSync itself was
// imported as an ESM named binding snapshot.  This is the nested-object
// mutation technique.
// ---------------------------------------------------------------------------

const home = homedir();
const CRED_PATH_PREFIXES = [
  join(home, ".aws"),
  join(home, ".config", "gcloud"),
  join(home, ".azure"),
] as const;

function isCredPath(filePath: string): boolean {
  return CRED_PATH_PREFIXES.some(
    (prefix) => filePath === prefix || filePath.startsWith(prefix + sep),
  );
}

type FsMod = { openSync: AnyFn };
const fsMod = _require("fs") as FsMod;
const _origOpenSync = fsMod.openSync;
fsMod.openSync = (...args: unknown[]): unknown => {
  const pathArg = args[0];
  const fp =
    typeof pathArg === "string"
      ? pathArg
      : pathArg instanceof URL
        ? pathArg.pathname
        : Buffer.isBuffer(pathArg)
          ? pathArg.toString()
          : null;
  if (fp !== null && isCredPath(fp)) {
    throw new Error(`no external credentials: reading "${fp}" is blocked`);
  }
  return _origOpenSync !== undefined ? _origOpenSync(...args) : undefined;
};
