import { HelloBanner } from "@/components/HelloBanner.tsx";

// Bootstrap placeholder. Story 000 mounts the real AppShell here. The SU7
// hello-world renders a token-styled primitive so the E2E proves the design
// path end to end over TLS.
export function App() {
  return (
    <main className="min-h-dvh bg-background text-foreground p-8">
      <HelloBanner label="kanthord control plane" />
    </main>
  );
}
