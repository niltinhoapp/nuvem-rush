import { randomUUID } from "node:crypto";
import { NuvemshopApiError, NuvemshopRequestError } from "@/lib/nuvemshop/client";
import type {
  DueWebhookEnvelope,
  WebhookInboxErrorCode,
  WebhookInboxRepository,
} from "./inbox";

export type OrderWebhookProcessingOutcome = "completed" | "discarded";

export interface OrderWebhookProcessor {
  process(candidate: DueWebhookEnvelope): Promise<OrderWebhookProcessingOutcome>;
}

export type WebhookWorkerStats = {
  listed: number;
  claimed: number;
  completed: number;
  retried: number;
  discarded: number;
  failed: number;
  skipped: number;
  leaseLost: number;
};

type ErrorDisposition =
  | { action: "discard" }
  | { action: "fail"; code: "PROCESSING_TERMINAL" }
  | { action: "retry"; code: Exclude<WebhookInboxErrorCode, "PROCESSING_TERMINAL"> };

const FIRESTORE_TRANSIENT_CODES = new Set([
  "aborted",
  "deadline-exceeded",
  "internal",
  "resource-exhausted",
  "unavailable",
]);

export function classifyWebhookWorkerError(error: unknown): ErrorDisposition {
  if (error instanceof NuvemshopApiError) {
    return error.transient
      ? { action: "retry", code: "NUVEMSHOP_TRANSIENT" }
      : { action: "fail", code: "PROCESSING_TERMINAL" };
  }
  if (error instanceof NuvemshopRequestError) {
    return { action: "retry", code: "NUVEMSHOP_TRANSIENT" };
  }
  if (error instanceof Error && error.message === "store_inactive") {
    return { action: "discard" };
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : "";
  if (FIRESTORE_TRANSIENT_CODES.has(code)) {
    return { action: "retry", code: "FIRESTORE_TRANSIENT" };
  }
  return { action: "retry", code: "PROCESSING_RECOVERABLE" };
}

export async function processWebhookInboxBatch(params: {
  repository: WebhookInboxRepository;
  processor: OrderWebhookProcessor;
  now?: number;
  batchSize: number;
  leaseIdFactory?: () => string;
}): Promise<WebhookWorkerStats> {
  const now = params.now ?? Date.now();
  const leaseIdFactory = params.leaseIdFactory ?? randomUUID;
  const due = await params.repository.listDue(now, params.batchSize);
  const stats: WebhookWorkerStats = {
    listed: due.length,
    claimed: 0,
    completed: 0,
    retried: 0,
    discarded: 0,
    failed: 0,
    skipped: 0,
    leaseLost: 0,
  };

  // Serial de proposito: limita pressao sobre a API por merchant/app. O
  // NuvemshopClient ja faz retry curto de GET; a inbox aplica o backoff externo
  // somente depois que essas tentativas internas se esgotam.
  for (const candidate of due) {
    const leaseId = leaseIdFactory();
    const claimed = await params.repository.claim({
      storeId: candidate.storeId,
      key: candidate.key,
      leaseId,
      now,
    });
    if (!claimed) {
      stats.skipped++;
      continue;
    }
    stats.claimed++;

    if (!claimed.storeActive) {
      const discarded = await params.repository.discard({
        storeId: candidate.storeId,
        key: candidate.key,
        leaseId,
        now,
      });
      if (discarded) stats.discarded++;
      else stats.leaseLost++;
      continue;
    }

    try {
      const outcome = await params.processor.process({
        ...candidate,
        envelope: claimed.envelope,
      });
      const finalized = outcome === "discarded"
        ? await params.repository.discard({
            storeId: candidate.storeId, key: candidate.key, leaseId, now,
          })
        : await params.repository.complete({
            storeId: candidate.storeId, key: candidate.key, leaseId, now,
          });
      if (!finalized) stats.leaseLost++;
      else if (outcome === "discarded") stats.discarded++;
      else stats.completed++;
    } catch (error) {
      const disposition = classifyWebhookWorkerError(error);
      if (disposition.action === "discard") {
        const updated = await params.repository.discard({
          storeId: candidate.storeId, key: candidate.key, leaseId, now,
        });
        if (updated) stats.discarded++;
        else stats.leaseLost++;
      } else if (disposition.action === "fail") {
        const updated = await params.repository.fail({
          storeId: candidate.storeId,
          key: candidate.key,
          leaseId,
          now,
          errorCode: disposition.code,
        });
        if (updated) stats.failed++;
        else stats.leaseLost++;
      } else {
        const result = await params.repository.retry({
          storeId: candidate.storeId,
          key: candidate.key,
          leaseId,
          now,
          errorCode: disposition.code,
        });
        if (!result.updated) stats.leaseLost++;
        else if (result.status === "failed") stats.failed++;
        else stats.retried++;
      }
    }
  }

  return stats;
}
