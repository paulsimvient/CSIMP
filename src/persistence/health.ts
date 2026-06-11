export type PersistenceHealth = {
  ok: boolean;
  lastError?: string;
  lastSuccessAt?: number;
};

let health: PersistenceHealth = { ok: true };
const listeners = new Set<(next: PersistenceHealth) => void>();

export function getPersistenceHealth(): PersistenceHealth {
  return health;
}

export function subscribePersistenceHealth(
  listener: (next: PersistenceHealth) => void
): () => void {
  listeners.add(listener);
  listener(health);
  return () => listeners.delete(listener);
}

function publish(next: PersistenceHealth): void {
  health = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export function recordPersistenceSuccess(): void {
  publish({
    ok: true,
    lastSuccessAt: Date.now(),
    lastError: undefined,
  });
}

export function recordPersistenceError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  publish({
    ok: false,
    lastError: message,
    lastSuccessAt: health.lastSuccessAt,
  });
}
