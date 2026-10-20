export const PLACEMENTS = ["server", "worker", "container"];

export function isServerManaged(placement) {
  return placement === "server" || placement === "container";
}
