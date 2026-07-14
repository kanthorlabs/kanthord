import { Button } from "@/components/ui/button.tsx";
import { locators } from "@/locators.ts";

// SU7 bootstrap hello-world: proves a vendored primitive (Button) styled by
// semantic tokens renders through the pipeline. Replaced by Story 000's shell.
export function HelloBanner({ label }: { label: string }) {
  return (
    <section className="bg-card text-card-foreground border-border rounded-lg border p-6">
      <h1 className="text-foreground text-xl font-semibold" data-testid={locators.helloBanner.title}>
        {label}
      </h1>
      <Button className="mt-4" data-testid={locators.helloBanner.action}>
        control plane ready
      </Button>
    </section>
  );
}
