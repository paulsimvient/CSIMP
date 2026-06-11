import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { AgentEvolutionService } from "./agentEvolution/service";
import { DoctrineForgeService } from "./doctrineForge/doctrineForgeService";
import type { OperationalFailureInput } from "../src/types/doctrine";

const MAX_BODY_BYTES = 512 * 1024;

let serviceSingleton: AgentEvolutionService | undefined;
let doctrineForgeSingleton: DoctrineForgeService | undefined;

function getDoctrineForge(coda2Root: string): DoctrineForgeService {
  if (!doctrineForgeSingleton) {
    doctrineForgeSingleton = new DoctrineForgeService({ coda2Root });
  }
  return doctrineForgeSingleton;
}

function getService(coda2Root: string): AgentEvolutionService {
  if (!serviceSingleton) {
    serviceSingleton = new AgentEvolutionService({ coda2Root });
  }
  return serviceSingleton;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveCoda2Root(): string {
  return process.env.CODA2_ROOT ?? join(import.meta.dirname, "../..");
}

export async function handleAgentEvolutionRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname.replace(/^\/api\/agent-evolution/, "") || "/";
  const coda2Root = resolveCoda2Root();
  const service = getService(coda2Root);
  const doctrineForge = getDoctrineForge(coda2Root);

  try {
    if (req.method === "GET" && pathname === "/doctrine/fossils") {
      sendJson(res, 200, { fossils: await doctrineForge.listFossils() });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/doctrine/passports/")) {
      const passportId = pathname.split("/").filter(Boolean)[2];
      if (!passportId) {
        sendJson(res, 400, { error: "Missing passport id" });
        return;
      }
      const passport = await doctrineForge.getPassport(passportId);
      if (!passport) {
        sendJson(res, 404, { error: "Passport not found" });
        return;
      }
      sendJson(res, 200, { passport });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/record-failure") {
      const body = (await readJsonBody(req)) as RecordFailureBody;
      if (body.demo) {
        sendJson(res, 200, {
          result: await doctrineForge.recordDemoFailure(body.agentId),
        });
        return;
      }
      if (!body.agentId || !body.scenarioRef || !body.scenarioPacket || !body.interpretation) {
        sendJson(res, 400, { error: "agentId, scenarioRef, scenarioPacket, interpretation required" });
        return;
      }
      sendJson(res, 200, {
        result: await doctrineForge.recordOperationalFailure({
          agentId: body.agentId,
          scenarioRef: body.scenarioRef,
          scenarioPacket: body.scenarioPacket as OperationalFailureInput["scenarioPacket"],
          interpretation: body.interpretation as OperationalFailureInput["interpretation"],
          evidenceRefs: body.evidenceRefs,
        }),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/forge") {
      const body = (await readJsonBody(req)) as ForgeBody;
      if (!body.baseScenarioId || !body.packet) {
        sendJson(res, 400, { error: "baseScenarioId and packet required" });
        return;
      }
      sendJson(res, 200, {
        forged: await doctrineForge.forgeFromPacket({
          baseScenarioId: body.baseScenarioId,
          packet: body.packet as import("../../src/intel/types").ScenarioPacket,
          failureClass: body.failureClass,
        }),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/passports/build") {
      const body = (await readJsonBody(req)) as BuildPassportBody;
      if (!body.agentId || !body.agentVersion || !body.parentVersion || !body.rollbackTarget) {
        sendJson(res, 400, {
          error: "agentId, agentVersion, parentVersion, rollbackTarget required",
        });
        return;
      }
      sendJson(res, 200, {
        ...(await doctrineForge.buildPassport({
          agentId: body.agentId,
          agentVersion: body.agentVersion,
          parentVersion: body.parentVersion,
          rollbackTarget: body.rollbackTarget,
          fossilIds: body.fossilIds,
          releaseId: body.releaseId,
          candidateInterpretation: body.candidateInterpretation as
            | import("../../src/intel/types").LLMInterpretation
            | undefined,
          runTournament: body.runTournament ?? true,
        })),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/red-team") {
      const body = (await readJsonBody(req)) as RedTeamBody;
      if (!body.baseScenarioId || !body.packet) {
        sendJson(res, 400, { error: "baseScenarioId and packet required" });
        return;
      }
      sendJson(res, 200, {
        challenge: await doctrineForge.runRedTeam({
          baseScenarioId: body.baseScenarioId,
          packet: body.packet as import("../../src/intel/types").ScenarioPacket,
          fossilId: body.fossilId,
        }),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/tournament") {
      const body = (await readJsonBody(req)) as TournamentBody;
      if (!body.agentId || !body.baseVersion) {
        sendJson(res, 400, { error: "agentId and baseVersion required" });
        return;
      }
      sendJson(res, 200, {
        session: await doctrineForge.runTournament({
          agentId: body.agentId,
          baseVersion: body.baseVersion,
          fossilIds: body.fossilIds,
        }),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/record-coa-failure") {
      const body = (await readJsonBody(req)) as RecordCoaFailureBody;
      if (!body.agentId || !body.blockers?.length || !body.scenarioPacket) {
        sendJson(res, 400, { error: "agentId, blockers, scenarioPacket required" });
        return;
      }
      sendJson(res, 200, {
        result: await doctrineForge.recordCoaFailure({
          agentId: body.agentId,
          coaRef: body.coaRef,
          blockers: body.blockers,
          status: body.status,
          scenarioPacket: body.scenarioPacket as import("../../src/intel/types").ScenarioPacket,
        }),
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/doctrine/envelope-routes/")) {
      const agentId = pathname.split("/").filter(Boolean)[2];
      if (!agentId) {
        sendJson(res, 400, { error: "Missing agent id" });
        return;
      }
      sendJson(res, 200, { routes: await doctrineForge.getEnvelopeRoutes(agentId) });
      return;
    }

    if (req.method === "POST" && pathname === "/doctrine/envelope-routes/register") {
      const body = (await readJsonBody(req)) as RegisterEnvelopeBody;
      if (!body.passportId) {
        sendJson(res, 400, { error: "passportId required" });
        return;
      }
      const passport = await doctrineForge.getPassport(body.passportId);
      if (!passport) {
        sendJson(res, 404, { error: "Passport not found" });
        return;
      }
      sendJson(res, 200, { routes: await doctrineForge.registerEnvelopeFromPassport(passport) });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/doctrine/mutation-budget/")) {
      const agentId = pathname.split("/").filter(Boolean)[2];
      if (!agentId) {
        sendJson(res, 400, { error: "Missing agent id" });
        return;
      }
      sendJson(res, 200, { budget: await doctrineForge.getMutationBudget(agentId) });
      return;
    }

    if (req.method === "GET" && pathname === "/agents") {
      sendJson(res, 200, { agents: await service.listAgents() });
      return;
    }

    if (req.method === "GET" && pathname === "/releases") {
      sendJson(res, 200, { releases: await service.listReleases() });
      return;
    }

    if (req.method === "GET" && pathname === "/audit") {
      const proposalId = url.searchParams.get("proposalId") ?? undefined;
      const releaseId = url.searchParams.get("releaseId") ?? undefined;
      sendJson(res, 200, {
        events: await service.listAudit({ proposalId, releaseId }),
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/agents/")) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length === 3 && parts[0] === "agents" && parts[2] === "production") {
        const agentId = parts[1];
        if (!agentId) {
          sendJson(res, 400, { error: "Missing agent id" });
          return;
        }
        const envelopeClass = url.searchParams.get("envelopeClass") ?? undefined;
        if (envelopeClass) {
          const resolved = await doctrineForge.resolveEnvelopeVersion(
            agentId,
            envelopeClass,
            service
          );
          const bundle = await service.getProductionBundle(agentId, resolved.version);
          sendJson(res, 200, {
            bundle,
            envelopeRoute: {
              envelopeClass,
              agentVersion: resolved.version,
              releaseId: resolved.route?.releaseId,
              passportId: resolved.route?.passportId,
              reasons: [`Envelope route: ${envelopeClass} → ${resolved.version}`],
              routed: Boolean(resolved.route),
            },
          });
          return;
        }
        sendJson(res, 200, { bundle: await service.getProductionBundle(agentId) });
        return;
      }
      const agentId = parts[1];
      const version = parts[2];
      if (!agentId || !version) {
        sendJson(res, 400, { error: "Use /agents/:id/:version" });
        return;
      }
      sendJson(res, 200, { agent: await service.getAgent(agentId, version) });
      return;
    }

    if (req.method === "POST" && pathname === "/proposals/validate") {
      const body = (await readJsonBody(req)) as ProcessProposalBody;
      const stages = await service.validateProposal(normalizeProposalBody(body));
      sendJson(res, 200, { stages });
      return;
    }

    if (req.method === "POST" && pathname === "/proposals/process") {
      const body = (await readJsonBody(req)) as ProcessProposalBody;
      const result = await service.processProposal(normalizeProposalBody(body));
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && pathname === "/proposals/evolve") {
      const body = (await readJsonBody(req)) as EvolveProposalBody;
      const result = await service.evolveProposal({
        rawProposal: body.rawProposal ?? body.proposal,
        objective: body.objective,
        evidenceRefs: body.evidenceRefs,
        targetAgentId: body.targetAgentId,
        baseAgentVersion: body.baseAgentVersion,
        baseCommitSha: body.baseCommitSha,
        maxRounds: body.maxRounds,
        actorBackend: body.actorBackend,
        productionVersion: body.productionVersion,
        candidateVersion: body.candidateVersion,
        skipEval: body.skipEval,
        skipShadow: body.skipShadow,
        autoProcessOnConverge: body.autoProcessOnConverge,
        nextVersion: body.nextVersion,
        approvals: (body.approvals ?? []).map((approval) => ({
          ...approval,
          timestamp: approval.timestamp ?? new Date().toISOString(),
        })),
      });
      sendJson(res, 200, result);
      return;
    }

    const advanceMatch = pathname.match(/^\/releases\/([^/]+)\/advance$/);
    if (req.method === "POST" && advanceMatch) {
      const body = (await readJsonBody(req)) as AdvanceBody;
      const release = await service.advanceRelease({
        releaseId: advanceMatch[1]!,
        targetStage: body.targetStage,
        approval: normalizeApproval(body.approval),
      });
      sendJson(res, 200, { release });
      return;
    }

    const rollbackMatch = pathname.match(/^\/releases\/([^/]+)\/rollback$/);
    if (req.method === "POST" && rollbackMatch) {
      const body = (await readJsonBody(req)) as RollbackBody;
      const release = await service.rollbackRelease({
        releaseId: rollbackMatch[1]!,
        approval: normalizeApproval(body.approval),
      });
      sendJson(res, 200, { release });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type EvolveProposalBody = ProcessProposalBody & {
  objective?: string;
  evidenceRefs?: string[];
  targetAgentId?: string;
  baseAgentVersion?: string;
  baseCommitSha?: string;
  maxRounds?: number;
  actorBackend?: "deterministic" | "llm" | "hybrid";
  productionVersion?: string;
  candidateVersion?: string;
  skipEval?: boolean;
  skipShadow?: boolean;
  autoProcessOnConverge?: boolean;
};

type ProcessProposalBody = {
  proposal?: unknown;
  rawProposal?: unknown;
  nextVersion: string;
  approvals?: Array<{
    reviewerId: string;
    decision: "approved" | "rejected";
    timestamp?: string;
    justification?: string;
  }>;
};

type AdvanceBody = {
  targetStage: "canary" | "production";
  approval: {
    reviewerId: string;
    decision: "approved" | "rejected";
    timestamp?: string;
    justification?: string;
  };
};

type RollbackBody = {
  approval: {
    reviewerId: string;
    decision: "approved" | "rejected";
    timestamp?: string;
    justification?: string;
  };
};

function normalizeApproval(approval: AdvanceBody["approval"]) {
  return {
    ...approval,
    timestamp: approval.timestamp ?? new Date().toISOString(),
  };
}

function normalizeProposalBody(body: ProcessProposalBody) {
  return {
    rawProposal: body.rawProposal ?? body.proposal,
    nextVersion: body.nextVersion,
    approvals: (body.approvals ?? []).map((approval) => ({
      ...approval,
      timestamp: approval.timestamp ?? new Date().toISOString(),
    })),
  };
}

export { AgentEvolutionService, DoctrineForgeService };

type RecordFailureBody = {
  demo?: boolean;
  agentId?: string;
  scenarioRef?: string;
  scenarioPacket?: unknown;
  interpretation?: unknown;
  evidenceRefs?: string[];
};

type ForgeBody = {
  baseScenarioId: string;
  packet: unknown;
  failureClass?: string;
};

type BuildPassportBody = {
  agentId: string;
  agentVersion: string;
  parentVersion: string;
  rollbackTarget: string;
  fossilIds?: string[];
  releaseId?: string;
  candidateInterpretation?: unknown;
  runTournament?: boolean;
};

type RedTeamBody = {
  baseScenarioId: string;
  packet: unknown;
  fossilId?: string;
};

type TournamentBody = {
  agentId: string;
  baseVersion: string;
  fossilIds?: string[];
};

type RecordCoaFailureBody = {
  agentId: string;
  coaRef?: string;
  blockers: string[];
  status?: "unsat" | "error" | "infeasible";
  scenarioPacket: unknown;
};

type RegisterEnvelopeBody = {
  passportId: string;
};
