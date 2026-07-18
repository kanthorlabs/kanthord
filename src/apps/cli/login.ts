import type {
  OAuthProviderInterface,
  OAuthCredentials,
} from "@earendil-works/pi-ai";
import { toResult } from "./error-map.ts";

export type SaveCredentialOpts = {
  projectId: string;
  name: string;
  provider: string;
  value: string;
};

export type LoginDeps = {
  getProvider(id: string): OAuthProviderInterface | undefined;
  saveCredential(opts: SaveCredentialOpts): Promise<string>;
};

export async function runLogin(
  provider: string,
  args: Record<string, unknown>,
  deps: LoginDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const projectId = args["project"];
  const name = args["name"];

  const oauthProvider = deps.getProvider(provider);
  if (oauthProvider === undefined) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [`error: no OAuth flow registered for provider ${provider}`],
    };
  }

  let creds: OAuthCredentials;
  try {
    creds = await oauthProvider.login({
      onAuth: () => {},
      onDeviceCode: () => {},
      onPrompt: async () => "",
      onProgress: () => {},
      onManualCodeInput: async () => "",
      onSelect: async () => undefined,
    });
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }

  let credId: string;
  try {
    credId = await deps.saveCredential({
      projectId: projectId as string,
      name: name as string,
      provider,
      value: JSON.stringify(creds),
    });
  } catch (err) {
    return { ...toResult(err), stdout: [] };
  }

  return { exitCode: 0, stdout: [credId], stderr: [] };
}
