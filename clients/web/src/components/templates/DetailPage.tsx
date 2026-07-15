/**
 * DetailPage template — DESIGN §6 page template for drill-down surfaces.
 * Slots: breadcrumb nav trail + vendored Tabs (DESIGN §5 Feature drill-down).
 *
 * DESIGN §8 placement for Tabs:
 *   - each tab trigger carries locators.detailPage.tabTrigger(id)
 *   - each tab panel carries locators.detailPage.tabPanel(id)
 *   - not the list wrapper (TabsList gets no testid per §8)
 *
 * All panels use forceMount so inactive panels remain in the DOM (hidden by
 * Radix data-state="inactive") — required by the DetailPage tests.
 */
import type { ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { locators } from "@/locators";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

export interface DetailPageProps {
  breadcrumb: BreadcrumbItem[];
  tabs: TabDef[];
  defaultTab: string;
}

export function DetailPage({ breadcrumb, tabs, defaultTab }: DetailPageProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb slot — DESIGN §8 locator on the container */}
      <nav
        data-testid={locators.detailPage.breadcrumb}
        aria-label="breadcrumb"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        {breadcrumb.map((item, i) => (
          <span key={item.label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.href !== undefined ? (
              <a href={item.href} className="hover:text-foreground">
                {item.label}
              </a>
            ) : (
              <span className="text-foreground">{item.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Tabs — DESIGN §8: trigger + panel each carry a locator */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              data-testid={locators.detailPage.tabTrigger(tab.id)}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            data-testid={locators.detailPage.tabPanel(tab.id)}
            forceMount
          >
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
