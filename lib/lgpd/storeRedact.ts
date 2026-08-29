import type { LgpdWebhook } from "./model";

export type StoreRedactStatus = "pending" | "processing" | "completed" | "failed";

export type StoreRedactEvidence = {
  requestId: string;
  type: "store/redact";
  status: StoreRedactStatus;
  attempts: number;
  receivedAt: number;
  updatedAt: number;
  processingAt?: number;
  leaseId?: string;
  completedAt?: number;
  errorCode?: string;
  affected?: Record<string, number>;
};

export interface StoreRedactRepository {
  begin(payload: LgpdWebhook, now: number): Promise<
    | { action: "process"; evidence: StoreRedactEvidence }
    | { action: "duplicate"; evidence: StoreRedactEvidence }
  >;
  purge(
    payload: LgpdWebhook,
    evidence: StoreRedactEvidence,
    now: number,
  ): Promise<Record<string, number>>;
  complete(
    payload: LgpdWebhook,
    evidence: StoreRedactEvidence,
    affected: Record<string, number>,
    now: number,
  ): Promise<void>;
  fail(evidence: StoreRedactEvidence, errorCode: string, now: number): Promise<void>;
}

export function sanitizeStoreRedactError(error: unknown): string {
  const code = error instanceof Error ? error.message : "unknown";
  return new Set([
    "lgpd_store_not_found",
    "lgpd_store_redact_in_progress",
    "lgpd_store_redact_lease_lost",
  ]).has(code) ? code : "lgpd_store_redact_failed";
}

export async function processStoreRedact(
  repository: StoreRedactRepository,
  payload: LgpdWebhook,
  now: number = Date.now(),
): Promise<
  | { ok: true; deduped: true }
  | { ok: true; deduped: false; affected: Record<string, number> }
> {
  if (payload.event !== "store/redact") throw new Error("lgpd_store_redact_invalid_event");
  const claim = await repository.begin(payload, now);
  if (claim.action === "duplicate") return { ok: true, deduped: true };

  try {
    const affected = await repository.purge(payload, claim.evidence, now);
    await repository.complete(payload, claim.evidence, affected, now);
    return { ok: true, deduped: false, affected };
  } catch (error) {
    await repository.fail(claim.evidence, sanitizeStoreRedactError(error), now);
    throw error;
  }
}
