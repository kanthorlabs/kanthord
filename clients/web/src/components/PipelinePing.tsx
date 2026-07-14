import { Badge } from "@/components/ui/badge";
import { locators } from "@/locators.ts";

interface PipelinePingProps {
  label: string;
}

export function PipelinePing({ label }: PipelinePingProps) {
  return (
    <div>
      <span data-testid={locators.pipelinePing.label}>{label}</span>
      <Badge data-testid={locators.pipelinePing.badge}>ready</Badge>
    </div>
  );
}
