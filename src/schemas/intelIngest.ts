import { z } from "zod";

const factDomainSchema = z.enum([
  "UAS",
  "cyber",
  "maritime",
  "ground",
  "air",
  "space",
  "information",
  "logistics",
  "signals",
]);

const confidenceSchema = z.enum(["low", "medium", "high"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);

export const rawSourceReportSchema = z.object({
  reportId: z.string().min(1).max(256),
  source: z.string().min(1).max(256),
  domain: factDomainSchema,
  timestamp: z.string().min(1).max(64),
  text: z.string().min(1).max(16_000),
  metadata: z.record(z.unknown()).optional(),
});

export const observedFactIngestSchema = z.object({
  id: z.string().min(1).max(256),
  domain: factDomainSchema,
  entity: z.string().min(1).max(512),
  event: z.string().min(1).max(1024),
  time: z.string().min(1).max(64),
  location: z.string().max(512).optional(),
  coordinates: z
    .object({
      lat: z.number().finite(),
      lng: z.number().finite(),
    })
    .optional(),
  source: z.string().min(1).max(256),
  confidence: confidenceSchema,
  severity: severitySchema,
  rawEvidenceRef: z.string().max(512).optional(),
  sourceType: z.enum(["loaded-fact", "scenario-demo"]).optional(),
  coordinateType: z.enum(["reported", "derived", "stub"]).optional(),
});

export const intelIngestBodySchema = z
  .object({
    reports: z.array(rawSourceReportSchema).max(500).optional(),
    facts: z.array(observedFactIngestSchema).max(500).optional(),
  })
  .refine((body) => (body.reports?.length ?? 0) + (body.facts?.length ?? 0) > 0, {
    message: "Provide at least one report or fact",
  });

export type IntelIngestBody = z.infer<typeof intelIngestBodySchema>;
