import { hydrateCoaState } from "../coa/store";
import { hydrateIntelState } from "../intel/pipeline";

export type BootstrapResult = {
  intelHydrated: boolean;
  coaHydrated: boolean;
  error?: string;
};

export async function bootstrapPersistedState(): Promise<BootstrapResult> {
  let intelHydrated = false;
  let coaHydrated = false;

  try {
    [intelHydrated, coaHydrated] = await Promise.all([
      hydrateIntelState(),
      hydrateCoaState(),
    ]);
  } catch (err) {
    return {
      intelHydrated,
      coaHydrated,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { intelHydrated, coaHydrated };
}
