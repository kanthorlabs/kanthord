/**
 * src/broker/verbs/github-http — real fetch-backed GithubHttpSeam.
 * Uses platform fetch (Node 24); no HTTP client dependency.
 */

import type {
  GithubHttpSeam,
  CreatePrResponse,
  CreatePrDuplicateResponse,
  GetPrResponse,
  RateLimitResponse,
  ListPrResponse,
} from "./github-create-pr.ts";

const DEFAULT_BASE_URL = "https://api.github.com";

export type GithubHttpSeamOpts = {
  baseUrl?: string;
  token: string;
};

export function makeGithubHttpSeam({
  baseUrl = DEFAULT_BASE_URL,
  token,
}: GithubHttpSeamOpts): GithubHttpSeam {
  const fixedHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  async function doFetch(
    method: string,
    path: string,
    extraHeaders: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { ...extraHeaders, ...fixedHeaders };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const init: RequestInit = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    const resp = await fetch(url, init);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: unknown = await resp.json();
    return { status: resp.status, json };
  }

  const createPr = async (
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<CreatePrResponse | CreatePrDuplicateResponse> => {
    const { status, json } = await doFetch("POST", path, headers, body);
    if (status === 201) {
      const j = json as { number: number; html_url: string };
      return { status: 201, number: j.number, url: j.html_url };
    }
    if (status === 422) {
      const j = json as { message: string };
      return { status: 422, message: j.message };
    }
    throw new Error(`GitHub API POST ${path} returned unexpected status ${status}`);
  };

  const getPr = async (
    path: string,
    headers: Record<string, string>,
  ): Promise<GetPrResponse | RateLimitResponse> => {
    const { status, json } = await doFetch("GET", path, headers);
    if (status === 429) {
      const j = json as { retry_after?: number };
      return { status: 429, retry_after: j.retry_after ?? 60 };
    }
    if (status === 200) {
      const j = json as { number: number; state: string; html_url: string; merged: boolean };
      const state: "open" | "closed" | "merged" =
        j.merged === true ? "merged" : j.state === "open" ? "open" : "closed";
      return { number: j.number, state, url: j.html_url, merged: j.merged };
    }
    throw new Error(`GitHub API GET ${path} returned unexpected status ${status}`);
  };

  const listByHead = async (
    path: string,
    headers: Record<string, string>,
  ): Promise<ListPrResponse> => {
    const { status, json } = await doFetch("GET", path, headers);
    if (status === 200) {
      const arr = json as Array<{ number: number; state: string; html_url: string }>;
      return arr.map((item) => ({
        number: item.number,
        state: item.state,
        url: item.html_url,
      }));
    }
    throw new Error(`GitHub API GET ${path} returned unexpected status ${status}`);
  };

  return { createPr, getPr, listByHead };
}
