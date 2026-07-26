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

  const model =
    typeof args["model"] === "string" && args["model"] !== ""
      ? (args["model"] as string)
      : undefined;

  // Build selectModel callback for interactive model selection (used when --model absent).
  const selectModel =
    model === undefined
      ? async (models: string[]) => {
          const numbered = models.map((m, i) => `  ${i + 1}. ${m}`).join("\n");
          io.print(`Available models:\n${numbered}`);
          const pick = await io.prompt("Select a model:");
          if (!models.includes(pick)) {
            throw new Error(`invalid model selection "${pick}"`);
          }
          return pick;
        }
      : undefined;

  const baseUrl =
    typeof args["baseUrl"] === "string" && args["baseUrl"] !== ""
      ? (args["baseUrl"] as string)
      : undefined;

  const effort =
    typeof args["effort"] === "string" && args["effort"] !== ""
      ? (args["effort"] as string)
      : undefined;

  try {
    const id = await deps.loginProvider.execute({
      providerId,
      name,
      method,
      presenter,
      ...(model !== undefined ? { model } : {}),
      ...(selectModel !== undefined ? { selectModel } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
    return {
      exitCode: 0,
      stdout: [id],
      stderr: [`ai-provider registered: ${id}`],
    };
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
