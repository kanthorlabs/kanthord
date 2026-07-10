export type HoldPointConfig = {
  holds: Record<string, "pre-submit" | "pre-completion">;
};

export type HoldPoint = {
  shouldHold(verb: string, cutpoint: "pre-submit" | "pre-completion"): boolean;
  hold(opId: string): void;
  release(opId: string): void;
  isHeld(opId: string): boolean;
};

export function makeHoldPoint(config: HoldPointConfig): HoldPoint {
  const held = new Set<string>();

  return {
    shouldHold(verb: string, cutpoint: "pre-submit" | "pre-completion"): boolean {
      const configured = config.holds[verb];
      return configured !== undefined && configured === cutpoint;
    },
    hold(opId: string): void {
      held.add(opId);
    },
    release(opId: string): void {
      held.delete(opId);
    },
    isHeld(opId: string): boolean {
      return held.has(opId);
    },
  };
}
