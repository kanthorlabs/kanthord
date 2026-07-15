/**
 * DiffPane — DESIGN §5 diff-pane composite (Story 002 T3).
 *
 * Renders a multi-file diff with file boundaries preserved, wrapped in a
 * ScrollArea so long content scrolls within the pane (DESIGN §7).
 *
 * Line treatment uses semantic tokens only (DESIGN §3):
 *   add lines → bg-diff-add text-diff-add-foreground
 *   del lines → bg-diff-del text-diff-del-foreground
 *   ctx lines → text-muted-foreground
 */
import { ScrollArea } from "@/components/ui/scroll-area";
import { locators } from "@/locators";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  content: string;
}

export interface DiffFile {
  path: string;
  lines: DiffLine[];
}

interface DiffPaneProps {
  files: DiffFile[];
}

export function DiffPane({ files }: DiffPaneProps) {
  return (
    <ScrollArea
      data-testid={locators.diffPane.root}
      className="max-h-96 rounded-md border border-border bg-card"
    >
      {files.map((file) => (
        <div key={file.path} data-testid={locators.diffPane.file}>
          <div className="border-b border-border bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
            {file.path}
          </div>
          <pre className="font-mono text-xs">
            {file.lines.map((line, i) => {
              if (line.type === "add") {
                return (
                  <div
                    key={i}
                    data-testid={locators.diffPane.addLine}
                    className="bg-diff-add px-3 text-diff-add-foreground"
                  >
                    {`+ ${line.content}`}
                  </div>
                );
              }
              if (line.type === "del") {
                return (
                  <div
                    key={i}
                    data-testid={locators.diffPane.delLine}
                    className="bg-diff-del px-3 text-diff-del-foreground"
                  >
                    {`- ${line.content}`}
                  </div>
                );
              }
              // ctx
              return (
                <div key={i} className="px-3 text-muted-foreground">
                  {`  ${line.content}`}
                </div>
              );
            })}
          </pre>
        </div>
      ))}
    </ScrollArea>
  );
}
