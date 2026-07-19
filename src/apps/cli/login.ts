import type {
  LoginProvider,
  OAuthLoginPresenter,
} from "../../app/auth/login-provider.ts";

/**
 * Live terminal I/O for the interactive OAuth flow. `print` writes immediately
 * (the auth URL must appear while the flow is still awaiting the callback);
 * `prompt` reads a single line from stdin.
 */
export type LoginIO = {
  print(message: string): void;
  prompt(message: string): Promise<string>;
};

export type LoginDeps = {
  loginProvider: LoginProvider;
  io: LoginIO;
};

export async function runLogin(
  providerId: string,
  args: Record<string, unknown>,
  deps: LoginDeps,
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const err = (message: string) => ({
    exitCode: 1,
    stdout: [] as string[],
    stderr: [`error: ${message}`],
  });

  // Validate CLI inputs BEFORE running the OAuth flow — a real browser login
  // must not complete only to fail on a missing/invalid value afterwards.
  if (typeof providerId !== "string" || providerId === "") {
    return err("missing required argument <provider>");
  }
  const projectId = args["project"];
  if (typeof projectId !== "string" || projectId === "") {
    return err("missing required flag --project");
  }
  const name = args["name"];
  if (typeof name !== "string" || name === "") {
    return err("missing required flag --name");
  }
  const method =
    typeof args["method"] === "string" && args["method"] !== ""
      ? (args["method"] as string)
      : "browser";
  if (method !== "browser" && method !== "device_code") {
    return err(`invalid --method "${method}": must be browser or device_code`);
  }

  const { io } = deps;
  const presenter: OAuthLoginPresenter = {
    showAuthUrl: (url, instructions) => {
      io.print(`\nOpen this URL in your browser to authenticate:\n${url}\n`);
      if (instructions) io.print(instructions);
    },
    showDeviceCode: ({ userCode, verificationUri }) => {
      io.print(`\nGo to ${verificationUri} and enter code: ${userCode}\n`);
    },
    progress: (message) => io.print(message),
    promptCode: (message) => io.prompt(message),
  };

  try {
    const credId = await deps.loginProvider.execute({
      providerId,
      projectId,
      name,
      method,
      presenter,
    });
    return { exitCode: 0, stdout: [credId], stderr: [] };
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
