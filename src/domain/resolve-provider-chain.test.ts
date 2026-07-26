// src/domain/resolve-provider-chain.test.ts — pure function tests
// (008.2 Story C: zero-I/O provider-chain resolver).

import assert from "node:assert/strict";
import { test } from "node:test";

import type { GlobalAiProvider } from "../storage/port.ts";

import { resolveProviderChain } from "./resolve-provider-chain.ts";

function active(id: string): GlobalAiProvider {
  return {
    id,
    name: id,
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: null,
    state: "active",
    baseUrl: null,
    effort: null,
    credentialVersion: 1,
  };
}

function loggedOut(id: string): GlobalAiProvider {
  return {
    id,
    name: id,
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: null,
    state: "logged_out",
    baseUrl: null,
    effort: null,
    credentialVersion: 1,
  };
}

test("assigned active [P3,P2] + absent default P1 → [P3,P2,P1]", () => {
  const result = resolveProviderChain(
    [active("P3"), active("P2")],
    active("P1"),
  );
  assert.deepEqual(
    result.map((p) => p.id),
    ["P3", "P2", "P1"],
  );
});

test("default already in the list is not duplicated (first-wins dedup)", () => {
  const result = resolveProviderChain(
    [active("P3"), active("P2")],
    active("P3"),
  );
  assert.deepEqual(
    result.map((p) => p.id),
    ["P3", "P2"],
  );
});

test("logged_out assigned provider is dropped from the chain", () => {
  const result = resolveProviderChain(
    [active("P2"), loggedOut("P3")],
    active("P1"),
  );
  assert.deepEqual(
    result.map((p) => p.id),
    ["P2", "P1"],
  );
});

test("logged_out default is not appended", () => {
  const result = resolveProviderChain(
    [active("P3"), active("P2")],
    loggedOut("P1"),
  );
  assert.deepEqual(
    result.map((p) => p.id),
    ["P3", "P2"],
  );
});

test("no assignments + active default → [default]", () => {
  const result = resolveProviderChain([], active("P1"));
  assert.deepEqual(
    result.map((p) => p.id),
    ["P1"],
  );
});

test("nothing active → empty array", () => {
  const result = resolveProviderChain([], undefined);
  assert.deepEqual(result, []);
});
