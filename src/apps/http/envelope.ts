// src/apps/http/envelope.ts — the JSON success/error envelope shapes (Story 02).

export interface DataEnvelope<T> {
  data: T;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

export function dataEnvelope<T>(data: T): DataEnvelope<T> {
  return { data };
}

export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
): ErrorEnvelope {
  return { error: { code, message, requestId } };
}
