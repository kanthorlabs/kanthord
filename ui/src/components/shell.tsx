import type { ReactElement, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// --- shared nav items ---

const GLOBAL_NAV_ITEMS = [
  { label: "Inbox", to: "/inbox" },
  { label: "Projects", to: "/project" },
  { label: "Operations", to: "/operations" },
] as const;

const PROJECT_LEAVES = [
  { label: "Overview", leaf: "overview" },
  { label: "Graph", leaf: "graph" },
  { label: "Plan", leaf: "plan" },
  { label: "Resources", leaf: "resource" },
  { label: "Readiness", leaf: "readiness" },
] as const;

// --- nav link class ---

const NAV_LINK_CLASS =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

function navLinkActive({ isActive }: { isActive: boolean }): string {
  return cn(NAV_LINK_CLASS, isActive && "bg-accent text-accent-foreground");
}

// --- nav toggle ---

function NavToggle({ pendingCount }: { pendingCount: number }): ReactElement {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-testid="nav-toggle"
          aria-label={
            pendingCount > 0
              ? `Open navigation, ${pendingCount} pending`
              : "Open navigation"
          }
          className="md:hidden"
        >
          <Menu className="size-5" />
          {pendingCount > 0 && (
            <span data-testid="nav-pending" className="sr-only">
              {pendingCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <nav className="flex flex-col gap-1 p-4">
          {GLOBAL_NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end className={navLinkActive}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// --- GlobalShell ---

export interface GlobalShellProps {
  readonly freshness?: ReactNode;
  readonly pendingCount?: number;
  readonly children: ReactNode;
}

export function GlobalShell({
  freshness,
  pendingCount = 0,
  children,
}: GlobalShellProps): ReactElement {
  return (
    <div
      data-testid="global-shell"
      className="flex min-h-svh flex-col bg-sidebar"
    >
      <header className="flex h-14 items-center gap-4 border-b px-4">
        <NavToggle pendingCount={pendingCount} />
        <div data-testid="header-slot" className="flex-1">
          {freshness}
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r md:block">
          <nav data-testid="global-nav" className="flex flex-col gap-1 p-4">
            {GLOBAL_NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end className={navLinkActive}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main data-testid="shell-main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

// --- ProjectShell ---

export interface ProjectShellProps {
  readonly projectId: string;
  readonly segments: readonly string[];
  readonly pendingCount?: number;
  readonly children: ReactNode;
}

export function ProjectShell({
  projectId,
  segments,
  pendingCount = 0,
  children,
}: ProjectShellProps): ReactElement {
  return (
    <div
      data-testid="project-shell"
      className="flex min-h-svh flex-col bg-sidebar"
    >
      <header className="flex h-14 items-center gap-4 border-b px-4">
        <NavToggle pendingCount={pendingCount} />
        <Breadcrumb data-testid="breadcrumb">
          <BreadcrumbList>
            {segments.map((segment, i) => (
              <BreadcrumbItem key={segment}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbPage>{segment}</BreadcrumbPage>
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r md:block">
          <nav data-testid="project-nav" className="flex flex-col gap-1 p-4">
            {PROJECT_LEAVES.map((item) => (
              <NavLink
                key={item.leaf}
                to={`/project/${projectId}/${item.leaf}`}
                end
                className={navLinkActive}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main data-testid="shell-main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
