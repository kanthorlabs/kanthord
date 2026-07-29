// src/app/ai-provider/config-validation.test.ts — pure config-rule validator
// (018 S1: extraction of the register-path rules, shared by register + update).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCustomProviderConfig,
  validateBuiltinBaseUrl,
  type CustomProviderConfig,
} from "./config-validation.ts";
import {
  InvalidApiFlavorError,
  InvalidEffortError,
  MissingCustomProviderIdError,
  MissingBaseUrlError,
  InvalidBaseUrlError,
  InvalidNumericFlagError,
  InsecureEndpointError,
} from "./errors.ts";
import { EmbeddedCredentialError } from "../errors.ts";

const REQUIRE_BOTH = { customProviderId: true, baseUrl: true };
const REQUIRE_NEITHER = { customProviderId: false, baseUrl: false };

function validConfig(): CustomProviderConfig {
  return {
    api: "openai-completions",
    effort: "medium",
    customProviderId: "my-custom-id",
    baseUrl: "https://example.com/v1",
    contextWindow: 32768,
    maxTokens: 4096,
  };
}

test("validateCustomProviderConfig rule 1 — rejects an unknown api flavor", () => {
  const cfg = { ...validConfig(), api: "not-a-flavor" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidApiFlavorError,
  );
});

test("validateCustomProviderConfig rule 2 — rejects an unknown effort", () => {
  const cfg = { ...validConfig(), effort: "not-an-effort" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidEffortError,
  );
});

test("validateCustomProviderConfig rule 3 — requires customProviderId when required", () => {
  const cfg = { ...validConfig(), customProviderId: "" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    MissingCustomProviderIdError,
  );
  const cfgUndefined = { ...validConfig(), customProviderId: undefined };
  assert.throws(
    () => validateCustomProviderConfig(cfgUndefined, REQUIRE_BOTH),
    MissingCustomProviderIdError,
  );
});

test("validateCustomProviderConfig rule 4 — requires baseUrl when required", () => {
  const cfg = { ...validConfig(), baseUrl: "" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    MissingBaseUrlError,
  );
  const cfgUndefined = { ...validConfig(), baseUrl: undefined };
  assert.throws(
    () => validateCustomProviderConfig(cfgUndefined, REQUIRE_BOTH),
    MissingBaseUrlError,
  );
});

test("validateCustomProviderConfig rule 5 — rejects a malformed baseUrl", () => {
  const cfg = { ...validConfig(), baseUrl: "not a url" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidBaseUrlError,
  );
});

test("validateCustomProviderConfig rule 5 — rejects a non-http(s) baseUrl", () => {
  const cfg = { ...validConfig(), baseUrl: "ftp://example.com/v1" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidBaseUrlError,
  );
});

test("validateCustomProviderConfig rule 6 — rejects a non-positive-integer contextWindow", () => {
  const cfg = { ...validConfig(), contextWindow: 0 };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidNumericFlagError,
  );
});

test("validateCustomProviderConfig rule 7 — rejects a non-positive-integer maxTokens", () => {
  const cfg = { ...validConfig(), maxTokens: -1 };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InvalidNumericFlagError,
  );
});

test("validateCustomProviderConfig rule 8 — rejects a baseUrl with embedded userinfo", () => {
  const cfg = { ...validConfig(), baseUrl: "https://user:pass@example.com/v1" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    EmbeddedCredentialError,
  );
});

test("validateCustomProviderConfig rule 9 — rejects an insecure endpoint without allowInsecure", () => {
  const cfg = { ...validConfig(), baseUrl: "http://192.168.1.5/v1" };
  assert.throws(
    () => validateCustomProviderConfig(cfg, REQUIRE_BOTH),
    InsecureEndpointError,
  );
});

test("validateCustomProviderConfig rule 9 — allowInsecure suppresses InsecureEndpointError but not EmbeddedCredentialError", () => {
  const insecureOnly = {
    ...validConfig(),
    baseUrl: "http://192.168.1.5/v1",
    allowInsecure: true,
  };
  assert.doesNotThrow(() =>
    validateCustomProviderConfig(insecureOnly, REQUIRE_BOTH),
  );

  const userinfoAndInsecure = {
    ...validConfig(),
    baseUrl: "http://user:pass@192.168.1.5/v1",
    allowInsecure: true,
  };
  assert.throws(
    () => validateCustomProviderConfig(userinfoAndInsecure, REQUIRE_BOTH),
    EmbeddedCredentialError,
  );
});

test("validateCustomProviderConfig — a fully valid config does not throw", () => {
  assert.doesNotThrow(() =>
    validateCustomProviderConfig(validConfig(), REQUIRE_BOTH),
  );
});

test("validateCustomProviderConfig — require:{false,false} with both fields absent does not throw (update path)", () => {
  const cfg: CustomProviderConfig = {
    api: "openai-responses",
    effort: "high",
  };
  assert.doesNotThrow(() => validateCustomProviderConfig(cfg, REQUIRE_NEITHER));
});

test("validateBuiltinBaseUrl — accepts an absolute http(s) URL", () => {
  assert.doesNotThrow(() => validateBuiltinBaseUrl("https://api.example.com"));
});

test("validateBuiltinBaseUrl — rejects a malformed URL", () => {
  assert.throws(() => validateBuiltinBaseUrl("not a url"), InvalidBaseUrlError);
});

test("validateBuiltinBaseUrl — rejects a non-http(s) URL", () => {
  assert.throws(
    () => validateBuiltinBaseUrl("ftp://example.com"),
    InvalidBaseUrlError,
  );
});
