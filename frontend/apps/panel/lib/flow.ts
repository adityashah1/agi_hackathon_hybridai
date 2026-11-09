import {
  ActivityIcon,
  BarChart3Icon,
  ClipboardCheckIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

/** The six screens, in demo order. Shared by the sidebar (client) and the stepper (server). */
export const FLOW = [
  {
    step: 1,
    title: "Intake",
    href: "/intake",
    icon: MessageSquareIcon,
    blurb: "Describe the workflow. Confirm the spec card.",
  },
  {
    step: 2,
    title: "Preflight",
    href: "/preflight",
    icon: ClipboardCheckIcon,
    blurb: "Episode plan and modeled cost before anything spends credits.",
  },
  {
    step: 3,
    title: "Live run",
    href: "/run",
    icon: ActivityIcon,
    blurb: "Every step: where it ran, why, and what it cost.",
  },
  {
    step: 4,
    title: "Results",
    href: "/results",
    icon: BarChart3Icon,
    blurb:
      "Did the job get done, what did it cost, was each routing decision right.",
  },
  {
    step: 5,
    title: "What-if",
    href: "/what-if",
    icon: SlidersHorizontalIcon,
    blurb: "Gate sweep, bring your own model, infrastructure, deployment plan.",
  },
  {
    step: 6,
    title: "Boundary & report",
    href: "/boundary",
    icon: ShieldCheckIcon,
    blurb: "Exactly what crossed to the cloud. Export the report.",
  },
] as const;
