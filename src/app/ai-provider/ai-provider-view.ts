// src/app/ai-provider/ai-provider-view.ts — Read-only view of a global AI
// provider (008.1 Story C). Guaranteed to omit the `value` (credential secret)
// from every read path.

export interface AiProviderView {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  effort: string | null;
  state: "active" | "logged_out";
  isDefault: boolean;
}
