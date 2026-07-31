import type { ReactElement } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface CommandHandoffProps {
  /** The CLI invocation, rendered verbatim. */
  readonly command: string;
  /** Why the browser cannot do it, one sentence. */
  readonly reason: string;
}

export function CommandHandoff({
  command,
  reason,
}: CommandHandoffProps): ReactElement {
  return (
    <div
      data-testid="command-handoff"
      className="flex flex-col gap-2 rounded-md border p-3 text-sm"
    >
      <p data-testid="command-handoff-note">
        This runs in your terminal, not in the browser. {reason}
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="command-handoff-command"
          className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs"
        >
          {command}
        </code>
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="command-handoff-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(command);
          }}
        >
          <Copy aria-hidden="true" className="size-3.5" />
          Copy
        </Button>
      </div>
    </div>
  );
}
