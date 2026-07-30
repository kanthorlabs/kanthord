/**
 * Structural mirror of ModelInfo (src/apps/cli/models.ts:9-15). apps/http
 * declares its own shape rather than importing another app's module.
 */
export interface ModelInfoResult {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
}

export type ListModels = (provider?: string) => readonly ModelInfoResult[];

export interface ModelDtoView {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
  readonly [key: string]: unknown;
}

export function modelView(result: ModelInfoResult): ModelDtoView {
  return {
    provider: result.provider,
    id: result.id,
    name: result.name,
    reasoning: result.reasoning,
    contextWindow: result.contextWindow,
  };
}
