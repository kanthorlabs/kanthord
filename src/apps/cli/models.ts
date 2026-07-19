/**
 * `get models` — list the AI models available in the installed pi-ai catalog.
 *
 * Helps the human (and the agent) discover which provider/model ids are
 * actually usable before creating an ai-provider resource. Pi types are
 * confined to the composition root; this handler consumes a plain ModelInfo[].
 */

export type ModelInfo = {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
};

export type ListModels = (provider?: string) => ModelInfo[];

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

export function runGetModels(
  args: Record<string, unknown>,
  listModels: ListModels,
): HandlerResult {
  const provider =
    typeof args["provider"] === "string" && args["provider"] !== ""
      ? (args["provider"] as string)
      : undefined;
  const json = args["json"] === true;

  const models = listModels(provider);

  if (json) {
    return {
      exitCode: 0,
      stdout: [JSON.stringify(models, null, 2)],
      stderr: [],
    };
  }

  if (models.length === 0) {
    return {
      exitCode: 0,
      stdout: [],
      stderr: [
        provider
          ? `no models found for provider ${provider}`
          : "no models found",
      ],
    };
  }

  const lines = models.map(
    (m) =>
      `${m.provider}  ${m.id}  ${m.reasoning ? "reasoning" : "-"}  (ctx ${m.contextWindow})  ${m.name}`,
  );
  return {
    exitCode: 0,
    stdout: [`${models.length} model(s):`, ...lines],
    stderr: [],
  };
}
