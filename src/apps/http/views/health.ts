export interface HealthResult {
  readonly status: "ok";
  readonly version: string;
}

export interface HealthView {
  readonly status: "ok";
  readonly version: string;
  readonly [key: string]: unknown;
}

export function healthView(result: HealthResult): HealthView {
  return { status: result.status, version: result.version };
}
