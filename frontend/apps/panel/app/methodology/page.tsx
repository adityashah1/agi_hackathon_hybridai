import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { BookOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { FIELD_PROVENANCE, METRICS } from "@/lib/methodology";

export const metadata: Metadata = { title: "Methodology" };

const Page = () => (
  <>
    <PageHeader
      description="Every number on the panel, with its formula, the schema fields it reads, and whether it is measured or modeled."
      title="Methodology"
    />
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Differentiator
        claim="Nothing here is a black box."
        detail="Each metric names the exact fields of runner/schema.py it is computed from. A judge can check any tile against this table and the log."
        icon={BookOpenIcon}
      />
      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-base">Metrics</CardTitle>
          <CardDescription>
            Computed in apps/panel/lib/metrics.ts from StepRecord lines. Same
            code for the sample and for real runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Formula</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Provenance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map((m) => (
                <TableRow key={m.name}>
                  <TableCell className="align-top font-medium text-xs">
                    {m.name}
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    <div className="font-mono">{m.formula}</div>
                    {m.note ? (
                      <div className="mt-1 text-muted-foreground">{m.note}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal break-words align-top font-mono text-[11px] text-muted-foreground">
                    {m.fields.length ? m.fields.join(", ") : "–"}
                  </TableCell>
                  <TableCell className="align-top">
                    <ProvenanceBadge
                      how={m.note ?? m.formula}
                      kind={m.provenance}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-base">Fields</CardTitle>
          <CardDescription>
            How the runner fills each measured field. From the docstring of
            runner/schema.py.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>How it is obtained</TableHead>
                <TableHead>Provenance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FIELD_PROVENANCE.map((f) => (
                <TableRow key={f.field}>
                  <TableCell className="font-mono text-xs">{f.field}</TableCell>
                  <TableCell className="text-xs">{f.how}</TableCell>
                  <TableCell>
                    <ProvenanceBadge how={f.how} kind={f.provenance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  </>
);

export default Page;
