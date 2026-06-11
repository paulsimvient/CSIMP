import { z } from "zod";

export const riskClassSchema = z.enum(["low", "medium", "high"]);

export const changeTierSchema = z.enum([
  "policy-update",
  "agent-module",
  "shared-infrastructure",
]);

export const policyChangeSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith("policies/agents/"), {
      message: "Policy changes must live under policies/agents/",
    }),
  operation: z.enum(["add-rule", "remove-rule", "replace-rule", "set-threshold"]),
  rule: z.string().optional(),
  key: z.string().optional(),
  value: z.unknown().optional(),
});

export const changedFileSchema = z.object({
  path: z.string().min(1),
  patch: z.string().min(1),
  reason: z.string().min(1),
});

export const agentPatchProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    targetAgentId: z.string().min(1),
    baseAgentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    baseCommitSha: z.string().min(7).max(64),
    changeTier: changeTierSchema,
    objective: z.string().min(10).max(4000),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    changedFiles: z.array(changedFileSchema),
    testsAddedOrChanged: z.array(z.string().min(1)),
    expectedBenefits: z.array(z.string().min(1)).min(1),
    knownRisks: z.array(z.string().min(1)),
    requestedRiskClass: riskClassSchema,
    policyChanges: z.array(policyChangeSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.changeTier === "policy-update") {
      if (!value.policyChanges || value.policyChanges.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "policy-update proposals require policyChanges[]",
          path: ["policyChanges"],
        });
      }
      if (value.changedFiles.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tier A policy-update proposals must not include changedFiles",
          path: ["changedFiles"],
        });
      }
    } else if (value.changedFiles.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent-module and shared-infrastructure proposals require changedFiles[]",
        path: ["changedFiles"],
      });
    }
  });

export type ParsedAgentPatchProposal = z.infer<typeof agentPatchProposalSchema>;

export function parseAgentPatchProposal(input: unknown): ParsedAgentPatchProposal {
  return agentPatchProposalSchema.parse(input);
}

export function safeParseAgentPatchProposal(input: unknown) {
  return agentPatchProposalSchema.safeParse(input);
}
