// src/apps/http/errors.ts — transport-level error classes the HTTP app raises itself (Story 02).

export class HttpFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "HttpFailure";
    this.code = code;
    this.status = status;
  }
}

export class InvalidInputError extends HttpFailure {
  readonly field: string;

  constructor(field: string, detail: string) {
    super("invalid_input", 400, `invalid ${field}: ${detail}`);
    this.name = "InvalidInputError";
    this.field = field;
  }
}
