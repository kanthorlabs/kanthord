// Story 01 — EntityWorkspace: the W2 frame with gate handling.
import type { ReactElement, ReactNode } from "react";

import type { Gate } from "@/lib/entity-scope";
import { ProjectShell } from "@/components/shell";
import { AsyncBoundary } from "@/components/async-boundary";
import { ScopeMismatch } from "./scope-mismatch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface EntityTab {
  /** Stable slug for `Tabs`, e.g. "summary". */
  readonly value: string;
  /** The visible tab label, e.g. "Summary". */
  readonly label: string;
  readonly panel: ReactNode;
}

export interface EntityWorkspaceProps {
  readonly projectId: string;
  readonly segments: readonly string[];
  readonly gate: Gate;
  /** The entity kind, e.g. "Initiative". Rendered beside the name. */
  readonly kindLabel: string;
  /** The entity's real name. Read only when `gate === null`. */
  readonly name: string;
  /** Fixed per page; `[]` until Stories 03/04/05/07 fill it. */
  readonly tabs: readonly EntityTab[];
  /** Actions rendered in the header area (rename controls, etc.). */
  readonly actions?: ReactNode;
}

export function EntityWorkspace({
  projectId,
  segments,
  gate,
  kindLabel,
  name,
  tabs,
  actions,
}: EntityWorkspaceProps): ReactElement {
  return (
    <ProjectShell projectId={projectId} segments={segments}>
      {gate !== null ? (
        gate.kind === "mismatch" ? (
          <ScopeMismatch info={gate.info} />
        ) : (
          <AsyncBoundary
            state={gate.state}
            what={gate.what}
            message={gate.message}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <header
            data-testid="entity-header"
            data-kind={kindLabel}
            className="flex items-center justify-between"
          >
            <div>
              <p className="text-muted-foreground text-xs">{kindLabel}</p>
              <h1 className="text-lg font-semibold">{name}</h1>
            </div>
            {actions}
          </header>
          {tabs.length > 0 && (
            <Tabs defaultValue={tabs[0]!.value}>
              <TabsList data-testid="entity-tabs">
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tabs.map((t) => (
                <TabsContent
                  key={t.value}
                  value={t.value}
                  data-testid="tab-panel"
                >
                  {t.panel}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}
    </ProjectShell>
  );
}
