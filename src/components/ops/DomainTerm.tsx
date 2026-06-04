import type { ReactNode } from "react";
import styles from "./DomainTerm.module.css";

export const DOMAIN_GLOSSARY = {
  coa: "Course of Action — a planned response option built from scheduled tasks.",
  hPlus: "Elapsed mission time after execution begins (H-hour plus offset).",
  syncMatrix:
    "Synchronization matrix — parallel tasks grouped by operational element on a shared timeline.",
  grounding:
    "Checks that model output is supported by observed facts before it influences planning.",
  rebase:
    "Update an operator draft onto the latest generated automated baseline after new intel.",
  feasible: "Plan satisfies hard constraints and can be loaded into the order set.",
  validatedOrderSet: "Revision that passed validation and is eligible for execution.",
} as const;

export type DomainTermId = keyof typeof DOMAIN_GLOSSARY;

type Props = {
  term: DomainTermId;
  children?: ReactNode;
  className?: string;
};

export function DomainTerm({ term, children, className }: Props) {
  const label = children ?? termLabel(term);
  return (
    <abbr
      className={[styles.term, className ?? ""].filter(Boolean).join(" ")}
      title={DOMAIN_GLOSSARY[term]}
    >
      {label}
    </abbr>
  );
}

function termLabel(term: DomainTermId): string {
  switch (term) {
    case "coa":
      return "COA";
    case "hPlus":
      return "H+";
    case "syncMatrix":
      return "Synchronization Matrix";
    case "grounding":
      return "Grounding";
    case "rebase":
      return "Rebase";
    case "feasible":
      return "Feasible";
    case "validatedOrderSet":
      return "Validated order set";
    default:
      return term;
  }
}
