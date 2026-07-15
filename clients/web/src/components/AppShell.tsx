/**
 * AppShell — the single page scaffold every story surface mounts into.
 * Implements DESIGN §6: shadcn Sidebar with six nav areas, header region,
 * content region, nav count-badge slot, and collapsed mobile-toggle indicator.
 * Never hand-rolls a drawer — uses the built-in sidebar mobile (off-canvas)
 * behavior from the vendored sidebar primitive.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { locators } from "@/locators";
import { ROUTES } from "@/app/routes";

type NavAreaKey = "features" | "inbox" | "broker" | "slots" | "budgets" | "ops";

type NavArea = {
  key: NavAreaKey;
  label: string;
  path: string;
};

const NAV_AREAS: NavArea[] = [
  { key: "features", label: "Features", path: ROUTES.features },
  { key: "inbox", label: "Inbox", path: ROUTES.inbox },
  { key: "broker", label: "Broker", path: ROUTES.broker },
  { key: "slots", label: "Slots", path: ROUTES.slots },
  { key: "budgets", label: "Budgets", path: ROUTES.budgets },
  { key: "ops", label: "Ops", path: ROUTES.ops },
];

interface AppShellProps {
  /** Per-area count badge values (DESIGN §6 nav count-badge slot). */
  navCounts?: Record<string, number>;
  children?: ReactNode;
}

/**
 * Inner shell — must render inside SidebarProvider so useSidebar() works.
 */
function AppShellInner({ navCounts, children }: AppShellProps) {
  const { isMobile } = useSidebar();

  const hasAnyCount = navCounts
    ? Object.values(navCounts).some((count) => count > 0)
    : false;

  return (
    <>
      <nav data-testid={locators.appShell.nav}>
      <Sidebar>
        <SidebarContent>
          <SidebarMenu>
            {NAV_AREAS.map(({ key, label, path }) => {
              const count = navCounts?.[key] ?? 0;
              return (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton asChild>
                    <Link
                      to={path}
                      data-testid={locators.appShell.navItem(key)}
                    >
                      {label}
                    </Link>
                  </SidebarMenuButton>
                  {count > 0 && (
                    <SidebarMenuBadge
                      data-testid={locators.appShell.navBadge}
                    >
                      {count}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      </nav>

      <SidebarInset>
        <header
          data-testid={locators.appShell.header}
          className="flex items-center gap-2 border-b bg-background px-4 py-3"
        >
          {/* Mobile sidebar toggle — always rendered; DESIGN §6 mobile behavior */}
          <SidebarTrigger
            data-testid={locators.appShell.mobileToggle}
            aria-label="Toggle navigation"
          />
          {/* Mobile indicator: visible when collapsed and any count is nonzero */}
          {isMobile && hasAnyCount && (
            <span
              data-testid={locators.appShell.mobileIndicator}
              className="size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
        </header>

        <main
          data-testid={locators.appShell.content}
          className="flex flex-1 flex-col p-4"
        >
          {children}
        </main>
      </SidebarInset>
    </>
  );
}

export function AppShell({ navCounts, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner navCounts={navCounts}>
        {children}
      </AppShellInner>
    </SidebarProvider>
  );
}
