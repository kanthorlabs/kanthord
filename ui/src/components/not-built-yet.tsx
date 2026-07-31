// S4 — NotBuiltYet: honest unavailable state placeholder (decision 5).
// Every leaf this epic does not build renders one shared NotBuiltYet that names
// its owning epic in the text. A test asserts each registered leaf either
// renders real content or renders NotBuiltYet; there is no third option.
import type { ReactElement } from "react";

export interface NotBuiltYetProps {
  readonly surface: string;
  readonly epic: string;
}

export function NotBuiltYet({ surface, epic }: NotBuiltYetProps): ReactElement {
  return (
    <div data-testid="not-built-yet" data-epic={epic}>
      {surface} is not built yet. EPIC {epic} builds it.
    </div>
  );
}
