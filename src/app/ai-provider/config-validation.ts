// src/app/ai-provider/config-validation.ts — pure config-rule validator
// (018 S1: extraction of the register-path rules, shared by register + update).

import { EmbeddedCredentialError } from "../errors.ts";
import {
  InvalidApiFlavorError,
  InvalidEffortError,
  MissingCustomProviderIdError,
  MissingBaseUrlError,
  InvalidBaseUrlError,
  InvalidNumericFlagError,
  InsecureEndpointError,
} from "./errors.ts";
import {
  hasEmbeddedUserinfo,
  isInsecureEndpoint,
  REASONING_EFFORTS,
} from "../../domain/resource.ts";

export interface CustomProviderConfig {
  api?: string;
  effort?: string;
  customProviderId?: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  allowInsecure?: boolean;
}

/**
 * Validates the custom OpenAI-compatible provider config.
 * `require.customProviderId` / `require.baseUrl` are true on the register path
 * (both fields are mandatory at creation) and false on the update path (a patch
 * omits what it does not change).
 */
export function validateCustomProviderConfig(
  cfg: CustomProviderConfig,
  require: { customProviderId: boolean; baseUrl: boolean },
): void {
  // 1. Validate api flavor before anything else
  if (
    cfg.api !== undefined &&
    cfg.api !== "openai-completions" &&
    cfg.api !== "openai-responses"
  ) {
    throw new InvalidApiFlavorError(cfg.api);
  }

  // 2. Validate effort against known reasoning efforts
  if (
    cfg.effort !== undefined &&
    !(REASONING_EFFORTS as readonly string[]).includes(cfg.effort)
  ) {
    throw new InvalidEffortError(cfg.effort);
  }

  // 3. Validate required custom fields
  if (
    require.customProviderId &&
    (cfg.customProviderId === undefined || cfg.customProviderId === "")
  ) {
    throw new MissingCustomProviderIdError();
  }
  // 4. Validate required baseUrl
  if (require.baseUrl && (cfg.baseUrl === undefined || cfg.baseUrl === "")) {
    throw new MissingBaseUrlError();
  }

  // 5. Validate baseUrl shape — must be an absolute http(s) URL
  if (cfg.baseUrl !== undefined) {
    try {
      const url = new URL(cfg.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new InvalidBaseUrlError(cfg.baseUrl);
      }
    } catch {
      throw new InvalidBaseUrlError(cfg.baseUrl);
    }
  }

  // 6. Validate numeric flags — must be positive integers
  if (
    cfg.contextWindow !== undefined &&
    (!Number.isInteger(cfg.contextWindow) || cfg.contextWindow <= 0)
  ) {
    throw new InvalidNumericFlagError("context-window", cfg.contextWindow);
  }
  // 7. Validate maxTokens
  if (
    cfg.maxTokens !== undefined &&
    (!Number.isInteger(cfg.maxTokens) || cfg.maxTokens <= 0)
  ) {
    throw new InvalidNumericFlagError("max-tokens", cfg.maxTokens);
  }

  // 8. Endpoint trust checks — embedded credentials
  if (cfg.baseUrl !== undefined && hasEmbeddedUserinfo(cfg.baseUrl)) {
    throw new EmbeddedCredentialError(cfg.baseUrl);
  }
  // 9. Endpoint trust checks — insecure endpoint
  if (
    cfg.baseUrl !== undefined &&
    !cfg.allowInsecure &&
    isInsecureEndpoint(cfg.baseUrl)
  ) {
    throw new InsecureEndpointError(cfg.baseUrl);
  }
}

/** Validates a baseUrl on the builtin path: absolute http(s) only. */
export function validateBuiltinBaseUrl(baseUrl: string): void {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new InvalidBaseUrlError(baseUrl);
    }
  } catch {
    throw new InvalidBaseUrlError(baseUrl);
  }
}
