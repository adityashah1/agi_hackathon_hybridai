import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import type { ReactNode } from "react";
import { SUITE } from "@/lib/data/task-suite";
import { modeLabel } from "@/lib/schema";
import { PREFERENCE_LABEL, SENSITIVITY_LABEL, type TaskSpec } from "@/lib/spec";

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid grid-cols-[9rem_1fr] gap-3 border-b py-2 text-sm last:border-b-0">
    <dt className="text-muted-foreground text-xs leading-5">{k}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);

export const SpecCard = ({
  spec,
  title = "Spec card",
}: {
  spec: TaskSpec;
  title?: string;
}) => (
  <Card className="gap-2">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        {title}
        <Badge className="font-mono text-[10px]" variant="outline">
          {spec.spec_id}
        </Badge>
      </CardTitle>
      <CardDescription>
        What the runner will read from tasks/. Nothing else from the chat is
        stored.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <dl>
        <Row k="Workflow">{spec.workflow}</Row>
        <Row k="Apps">{spec.app}</Row>
        <Row k="Done looks like">{spec.success_criteria}</Row>
        <Row k="Data on screen">{SENSITIVITY_LABEL[spec.sensitivity]}</Row>
        <Row k="Volume">
          <span className="tabular font-mono">{spec.daily_volume}</span> tasks
          per day
        </Row>
        <Row k="Preference">{PREFERENCE_LABEL[spec.preference]}</Row>
        <Row k="Escalation">{spec.escalation_targets.join(", ")}</Row>
        <Row k="Tasks">
          <div className="flex flex-wrap gap-1">
            {spec.task_ids.map((id) => {
              const t = SUITE.find((x) => x.id === id);
              return (
                <Badge
                  className="font-mono text-[10px]"
                  key={id}
                  title={t?.title}
                  variant="secondary"
                >
                  {id}
                  {t ? ` · ${t.app}` : ""}
                </Badge>
              );
            })}
          </div>
        </Row>
        <Row k="Modes">
          <div className="flex flex-wrap gap-1">
            {spec.modes.map((m) => (
              <Badge className="text-[10px]" key={m} variant="outline">
                {modeLabel(m)}
              </Badge>
            ))}
          </div>
        </Row>
        <Row k="Seeds">
          <span className="tabular font-mono">{spec.seeds}</span>
        </Row>
      </dl>
    </CardContent>
  </Card>
);
