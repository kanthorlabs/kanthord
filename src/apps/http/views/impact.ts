import type { DiscardPreview } from "../../../app/errors.ts";

export interface DiscardPreviewView {
  readonly damage: ReadonlyArray<{
    readonly target: {
      readonly type: string;
      readonly id: string;
      readonly name: string;
    };
    readonly effect: string;
  }>;
  readonly counts: Record<string, number>;
  readonly digest: string;
  readonly [key: string]: unknown;
}

export function discardPreviewView(result: DiscardPreview): DiscardPreviewView {
  return {
    damage: result.damage.map((d) => ({
      target: { type: d.target.type, id: d.target.id, name: d.target.name },
      effect: d.effect,
    })),
    counts: { ...result.counts },
    digest: result.digest,
  };
}

export interface TaskRejectionView {
  readonly skipped: readonly string[];
  readonly preview: DiscardPreviewView;
  readonly [key: string]: unknown;
}

export function taskRejectionView(result: {
  skipped: string[];
  preview: DiscardPreview;
}): TaskRejectionView {
  return {
    skipped: [...result.skipped],
    preview: discardPreviewView(result.preview),
  };
}

export interface ObjectiveRejectionView {
  readonly preview: DiscardPreviewView;
  readonly [key: string]: unknown;
}

export function objectiveRejectionView(result: {
  preview: DiscardPreview;
}): ObjectiveRejectionView {
  return { preview: discardPreviewView(result.preview) };
}
