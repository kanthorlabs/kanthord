import { createHash } from "node:crypto";

export interface ArtifactRegistry {
  publish(artifactId: string, contentHash: string): void;
  lookup(artifactId: string): { contentHash: string; status: "published" | "draft" } | undefined;
}

export type EdgeKind = "frozen" | "draft_ok";

export interface ConsumeCtx {
  taskId: string;
  artifactId: string;
  expectedHash: string;
  edgeKind: EdgeKind;
  registry: ArtifactRegistry;
  sink: { record(phase: string, outcome: string): void | Promise<void> };
}

export interface PublishCtx {
  taskId: string;
  artifactId: string;
  content: string;
  registry: Pick<ArtifactRegistry, "publish">;
  sink: { record(phase: string, outcome: string): void | Promise<void> };
}

export async function publishArtifact(ctx: PublishCtx): Promise<void> {
  const contentHash = createHash("sha256")
    .update(ctx.content, "utf8")
    .digest("hex");
  ctx.registry.publish(ctx.artifactId, contentHash);
  await ctx.sink.record("artifact published", "pass");
}

export async function consumeArtifact(ctx: ConsumeCtx): Promise<void> {
  const entry = ctx.registry.lookup(ctx.artifactId);
  let outcome: "pass" | "fail";
  if (entry === undefined) {
    outcome = "fail";
  } else if (ctx.edgeKind === "frozen") {
    outcome =
      entry.status === "published" && entry.contentHash === ctx.expectedHash
        ? "pass"
        : "fail";
  } else {
    // draft_ok: passes for any status (draft or published) with matching hash
    outcome = entry.contentHash === ctx.expectedHash ? "pass" : "fail";
  }
  await ctx.sink.record("artifact consumed", outcome);
}
