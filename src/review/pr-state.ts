export interface PrHttpSeam {
  getPrState(
    repo: string,
    prNumber: number,
  ): Promise<{ state: string; merged: boolean }>;
}

export type PrState = "merged" | "closed" | "open";

export async function pollPrState(opts: {
  repo: string;
  prNumber: number;
  http: PrHttpSeam;
}): Promise<PrState> {
  const { state, merged } = await opts.http.getPrState(
    opts.repo,
    opts.prNumber,
  );
  if (merged === true) return "merged";
  if (state === "closed") return "closed";
  return "open";
}
