"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Card, CardContent } from "@repo/design-system/components/ui/card";
import { Input } from "@repo/design-system/components/ui/input";
import { ScrollArea } from "@repo/design-system/components/ui/scroll-area";
import { cn } from "@repo/design-system/lib/utils";
import { BotIcon, RotateCcwIcon, SparklesIcon, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SpecCard } from "@/components/spec-card";
import { HERO_TASK_ID, SUITE, taskById } from "@/lib/data/task-suite";
import { MODES } from "@/lib/schema";
import {
  type EscalationTargetId,
  PREFERENCE_LABEL,
  type Preference,
  SAMPLE_SPEC,
  SENSITIVITY_LABEL,
  type Sensitivity,
  type TaskSpec,
} from "@/lib/spec";
import { useSpec } from "@/lib/use-spec";

type Field =
  | "workflow"
  | "success"
  | "sensitivity"
  | "volume"
  | "preference"
  | "target";

interface Question {
  choices?: { value: string; label: string }[];
  field: Field;
  kind: "text" | "number" | "choice";
  prompt: string;
}

const QUESTIONS: Question[] = [
  {
    field: "workflow",
    kind: "text",
    prompt:
      "What should the agent do for you? Describe the routine in a sentence. Today I know the eight tasks in tasks/tasks.yaml: Harbor Mail, the Acme Vendor Portal, Account Settings, and three real sites.",
  },
  {
    field: "success",
    kind: "text",
    prompt:
      "What does done look like? One sentence I can check against the app's final state.",
  },
  {
    field: "sensitivity",
    kind: "choice",
    prompt:
      "What shows up on screen while it works? This decides how strict the boundary view is.",
    choices: (Object.keys(SENSITIVITY_LABEL) as Sensitivity[]).map((v) => ({
      value: v,
      label: SENSITIVITY_LABEL[v],
    })),
  },
  {
    field: "volume",
    kind: "number",
    prompt:
      "Roughly how many of these tasks per day? I use it only for the cost and energy forecast.",
  },
  {
    field: "preference",
    kind: "choice",
    prompt: "When the local model hesitates, what matters more?",
    choices: (Object.keys(PREFERENCE_LABEL) as Preference[]).map((v) => ({
      value: v,
      label: PREFERENCE_LABEL[v],
    })),
  },
  {
    field: "target",
    kind: "choice",
    prompt: "Where may hard steps escalate to?",
    choices: [
      { value: "sai", label: "Simular Sai in the cloud" },
      {
        value: "deskside_open_model",
        label: "An open model on the desk-side box",
      },
      { value: "none", label: "Nowhere. Local only." },
    ],
  },
];

interface Answers {
  preference: Preference;
  sensitivity: Sensitivity;
  success: string;
  target: EscalationTargetId;
  volume: number;
  workflow: string;
}

interface Msg {
  id: number;
  role: "bot" | "user";
  text: string;
}

/** Keyword match from the free-text workflow to task ids in tasks/tasks.yaml. */
const matchTasks = (text: string): string[] => {
  const t = text.toLowerCase();
  const wants = (words: string[]) => words.some((w) => t.includes(w));
  const ids = new Set<string>();
  const dispute = wants([
    "dispute",
    "line item",
    "purchase order",
    "mismatch",
    "portal",
  ]);
  const mail = wants(["inbox", "email", "mail", "reply", "case number"]);
  if (dispute && mail) {
    ids.add("T1");
  } else if (dispute) {
    ids.add("T3");
  }
  if (wants(["phone", "sms"])) {
    ids.add("T2");
  }
  if (wants(["address", "finance ops"])) {
    ids.add("T4");
  }
  if (wants(["search", "ramen", "lunch", "exact"])) {
    ids.add("T5");
  }
  if (wants(["wikipedia", "stigmergy"])) {
    ids.add("T6");
  }
  if (wants(["github", "license"])) {
    ids.add("T7");
  }
  if (wants(["example.com", "iana"])) {
    ids.add("T8");
  }
  const ordered = SUITE.filter((task) => ids.has(task.id)).map(
    (task) => task.id
  );
  return ordered.length ? ordered : [HERO_TASK_ID];
};

const toSpec = (a: Answers): TaskSpec => {
  const task_ids = matchTasks(a.workflow);
  const apps = [...new Set(task_ids.map((id) => taskById(id)?.app ?? id))];
  return {
    spec_id: `spec_${Date.now().toString(36)}`,
    created_at: new Date().toISOString(),
    workflow: a.workflow,
    app: apps.join(", "),
    success_criteria: a.success,
    sensitivity: a.sensitivity,
    daily_volume: a.volume,
    preference: a.preference,
    escalation_targets: [a.target],
    task_ids,
    modes: [...MODES],
    seeds: 1,
  };
};

const DEMO_ANSWERS: Answers = {
  workflow: SAMPLE_SPEC.workflow,
  success: SAMPLE_SPEC.success_criteria,
  sensitivity: SAMPLE_SPEC.sensitivity,
  volume: SAMPLE_SPEC.daily_volume,
  preference: SAMPLE_SPEC.preference,
  target: "sai",
};

const first = QUESTIONS[0];

export const IntakeChat = () => {
  const router = useRouter();
  const { setSpec } = useSpec();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [msgs, setMsgs] = useState<Msg[]>(
    first ? [{ id: 0, role: "bot", text: first.prompt }] : []
  );
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<TaskSpec | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const current = QUESTIONS[idx];

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message or the draft card appears
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, draft]);

  const push = (role: Msg["role"], text: string) =>
    setMsgs((m) => [...m, { id: m.length, role, text }]);

  const finish = (a: Answers) => {
    const spec = toSpec(a);
    setDraft(spec);
    push(
      "bot",
      `Here is the spec card. I matched ${spec.task_ids.length} task${spec.task_ids.length === 1 ? "" : "s"} from tasks/tasks.yaml (${spec.task_ids.join(", ")}) across ${spec.app}. Confirm it and I will take you to preflight.`
    );
  };

  const submit = (raw: string, display?: string) => {
    if (!current) {
      return;
    }
    const value = raw.trim();
    if (!value) {
      return;
    }
    push("user", display ?? value);

    const next: Partial<Answers> = { ...answers };
    if (current.field === "volume") {
      const n = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
      next.volume = Number.isFinite(n) && n > 0 ? n : 40;
    } else if (current.field === "sensitivity") {
      next.sensitivity = value as Sensitivity;
    } else if (current.field === "preference") {
      next.preference = value as Preference;
    } else if (current.field === "target") {
      next.target = value as EscalationTargetId;
    } else {
      next[current.field] = value;
    }
    setAnswers(next);
    setInput("");

    const after = QUESTIONS[idx + 1];
    if (after) {
      setIdx(idx + 1);
      push("bot", after.prompt);
    } else {
      setIdx(idx + 1);
      finish(next as Answers);
    }
  };

  const prefill = () => {
    const spec = toSpec(DEMO_ANSWERS);
    setAnswers(DEMO_ANSWERS);
    setIdx(QUESTIONS.length);
    setMsgs([
      {
        id: 0,
        role: "bot",
        text: "Demo answers loaded. Review the spec card and confirm.",
      },
    ]);
    setDraft(spec);
  };

  const reset = () => {
    setIdx(0);
    setAnswers({});
    setDraft(null);
    setInput("");
    setMsgs(first ? [{ id: 0, role: "bot", text: first.prompt }] : []);
  };

  const confirm = async () => {
    if (!draft) {
      return;
    }
    setSpec(draft);
    try {
      const res = await fetch("/api/spec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (res.ok && data.path) {
        toast.success(`Spec saved to tasks/${draft.spec_id}.json`);
      } else {
        toast.message("Spec kept in this browser", {
          description:
            data.error ?? "The runner's tasks/ folder was not writable.",
        });
      }
    } catch {
      toast.message("Spec kept in this browser", {
        description: "Could not reach the panel's API.",
      });
    }
    router.push("/preflight");
  };

  let composer: ReactNode;
  if (current?.kind === "choice") {
    composer = (
      <div className="flex flex-wrap gap-2">
        {current.choices?.map((c) => (
          <Button
            key={c.value}
            onClick={() => submit(c.value, c.label)}
            size="sm"
            variant="outline"
          >
            {c.label}
          </Button>
        ))}
      </div>
    );
  } else if (current) {
    composer = (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <Input
          autoFocus
          inputMode={current.kind === "number" ? "numeric" : "text"}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            current.kind === "number" ? "e.g. 40" : "Type your answer"
          }
          value={input}
        />
        <Button type="submit">Send</Button>
      </form>
    );
  } else {
    composer = (
      <p className="text-muted-foreground text-xs">
        Confirm the spec card on the right, or reset to start over.
      </p>
    );
  }

  return (
    <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="flex min-h-[32rem] flex-col gap-0 py-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2 text-sm">
            <BotIcon className="size-4" />
            <span className="font-medium">Intake</span>
            <Badge className="text-[10px]" variant="outline">
              slot-filling · no model needed
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button onClick={prefill} size="sm" variant="ghost">
              <SparklesIcon /> Demo answers
            </Button>
            <Button onClick={reset} size="sm" variant="ghost">
              <RotateCcwIcon /> Reset
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 px-4">
          <div className="flex flex-col gap-3 py-4">
            {msgs.map((m) => (
              <div
                className={cn(
                  "flex gap-2",
                  m.role === "user" && "flex-row-reverse"
                )}
                key={m.id}
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full border">
                  {m.role === "bot" ? (
                    <BotIcon className="size-3" />
                  ) : (
                    <UserIcon className="size-3" />
                  )}
                </div>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    m.role === "bot"
                      ? "bg-muted"
                      : "bg-primary text-primary-foreground"
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
        <div className="border-t p-3">{composer}</div>
      </Card>

      <div className="flex flex-col gap-3">
        {draft ? (
          <>
            <SpecCard spec={draft} title="Confirm this spec" />
            <div className="flex gap-2">
              <Button onClick={confirm}>Save spec and go to preflight</Button>
              <Button onClick={reset} variant="outline">
                Edit answers
              </Button>
            </div>
          </>
        ) : (
          <Card className="gap-2">
            <CardContent className="text-muted-foreground text-sm">
              <p className="mb-2 font-medium text-foreground">
                Why this is a form wearing a chat
              </p>
              <p>
                Rule 1 allows one local model in memory, and the vision model
                owns it during a run. So intake fills slots deterministically
                and you confirm the card. The free-text answers are stored
                verbatim. The runner reads only the spec card.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
