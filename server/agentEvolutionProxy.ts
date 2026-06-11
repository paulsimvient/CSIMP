import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAgentEvolutionRequest } from "../CoAgenticModel/server/http.js";

export async function handleAgentEvolutionProxyRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleAgentEvolutionRequest(req, res);
}
