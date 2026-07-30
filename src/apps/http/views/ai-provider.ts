import type { AiProviderView } from "../../../app/ai-provider/ai-provider-view.ts";

export interface AiProviderDtoView {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly effort: string | null;
  readonly state: "active" | "logged_out";
  readonly isDefault: boolean;
  readonly [key: string]: unknown;
}

export function aiProviderView(result: AiProviderView): AiProviderDtoView {
  return {
    id: result.id,
    name: result.name,
    provider: result.provider,
    model: result.model,
    baseUrl: result.baseUrl,
    effort: result.effort,
    state: result.state,
    isDefault: result.isDefault,
  };
}
