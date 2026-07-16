/** Pure domain module — zero I/O. Proves type stripping + ESM `.ts` imports. */
export function greeting(name: string): string {
  return `Hello, ${name}!`;
}
