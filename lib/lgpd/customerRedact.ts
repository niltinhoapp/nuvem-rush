import type { LgpdWebhook, MinimalLgpdRequest } from "./model";

export type RedactCounts = {
  contacts: number;
  orders: number;
  carts: number;
  enrollments: number;
  jobsCancelled: number;
  jobsPreserved: number;
  logsSanitized: number;
  suppressions: number;
};

export interface CustomerRedactRepository {
  begin(payload: LgpdWebhook, now: number): Promise<
    | { action: "process"; request: MinimalLgpdRequest }
    | { action: "duplicate"; request: MinimalLgpdRequest }
  >;
  redact(payload: LgpdWebhook, request: MinimalLgpdRequest, now: number): Promise<RedactCounts>;
  complete(request: MinimalLgpdRequest, counts: RedactCounts, now: number): Promise<void>;
  fail(request: MinimalLgpdRequest, errorCode: string, now: number): Promise<void>;
}

export type CustomerRedactResult =
  | { ok: true; deduped: true }
  | { ok: true; deduped: false; counts: RedactCounts };

export function sanitizeLgpdError(error: unknown): string {
  const code = error instanceof Error ? error.message : "unknown";
  const allowed = new Set([
    "lgpd_store_not_found",
    "lgpd_customer_identifier_missing",
    "lgpd_customer_ambiguous",
    "lgpd_request_lease_lost",
    "lgpd_request_in_progress",
  ]);
  return allowed.has(code) ? code : "lgpd_processing_failed";
}

export async function processCustomerRedact(
  repo: CustomerRedactRepository,
  payload: LgpdWebhook,
  now: number = Date.now(),
): Promise<CustomerRedactResult> {
  const claim = await repo.begin(payload, now);
  if (claim.action === "duplicate") return { ok: true, deduped: true };

  try {
    const counts = await repo.redact(payload, claim.request, now);
    await repo.complete(claim.request, counts, now);
    return { ok: true, deduped: false, counts };
  } catch (error) {
    await repo.fail(claim.request, sanitizeLgpdError(error), now);
    throw error;
  }
}
