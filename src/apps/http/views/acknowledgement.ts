export interface AcknowledgementResult {
  readonly cursor: string;
}

export interface AcknowledgementView {
  readonly cursor: string;
  readonly [key: string]: unknown;
}

/** The cursor now IN EFFECT — see `src/app/project/ack-project.ts:85-94`. */
export function acknowledgementView(
  result: AcknowledgementResult,
): AcknowledgementView {
  return { cursor: result.cursor };
}
