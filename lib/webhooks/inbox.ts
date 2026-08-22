import { eventKey } from "./idempotency";

export const ORDER_WEBHOOK_EVENTS = [
  "order/paid",
  "order/created",
  "order/fulfilled",
  "order/cancelled",
] as const;

export type OrderWebhookEvent = (typeof ORDER_WEBHOOK_EVENTS)[number];
export type WebhookInboxStatus =
  | "received"
  | "processing"
  | "retry"
  | "completed"
  | "discarded"
  | "failed";

export type WebhookInboxErrorCode =
  | "NUVEMSHOP_TRANSIENT"
  | "FIRESTORE_TRANSIENT"
  | "PROCESSING_RECOVERABLE"
  | "PROCESSING_TERMINAL";

export type WebhookInboxEnvelope = {
  event: OrderWebhookEvent;
  resourceId: string;
  receivedAt: number;
  status: WebhookInboxStatus;
  attempts: number;
  nextAttemptAt: number | null;
  leaseId: string | null;
  claimedAt: number | null;
  completedAt: number | null;
  lastError: WebhookInboxErrorCode | null;
};

export type ReceiveWebhookInput = {
  storeId: string;
  key: string;
  event: OrderWebhookEvent;
  resourceId: string;
  receivedAt: number;
};

export type ReceiveWebhookResult = "created" | "duplicate" | "discarded";

export interface WebhookInboxRepository {
  receive(input: ReceiveWebhookInput): Promise<ReceiveWebhookResult>;
  claim(params: {
    storeId: string;
    key: string;
    leaseId: string;
    now: number;
  }): Promise<WebhookInboxEnvelope | null>;
  complete(params: { storeId: string; key: string; leaseId: string; now: number }): Promise<boolean>;
  retry(params: {
    storeId: string;
    key: string;
    leaseId: string;
    now: number;
    errorCode: Exclude<WebhookInboxErrorCode, "PROCESSING_TERMINAL">;
  }): Promise<{ updated: boolean; status: "retry" | "failed" }>;
  fail(params: {
    storeId: string;
    key: string;
    leaseId: string;
    now: number;
    errorCode: "PROCESSING_TERMINAL";
  }): Promise<boolean>;
  discard(params: { storeId: string; key: string; leaseId: string; now: number }): Promise<boolean>;
}

export const WEBHOOK_INBOX_LEASE_MS = 10 * 60_000;
export const WEBHOOK_INBOX_MAX_ATTEMPTS = 6;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

export function isOrderWebhookEvent(value: string): value is OrderWebhookEvent {
  return ORDER_WEBHOOK_EVENTS.some((event) => event === value);
}

export function canClaimWebhookEnvelope(
  envelope: Pick<WebhookInboxEnvelope, "status" | "nextAttemptAt" | "claimedAt">,
  now: number,
): boolean {
  if (envelope.status === "received") return true;
  if (envelope.status === "retry") {
    return typeof envelope.nextAttemptAt === "number" && envelope.nextAttemptAt <= now;
  }
  return envelope.status === "processing"
    && typeof envelope.claimedAt === "number"
    && now - envelope.claimedAt >= WEBHOOK_INBOX_LEASE_MS;
}

export function webhookInboxRetryPlan(
  attempts: number,
  now: number,
): { status: "retry" | "failed"; nextAttemptAt: number | null } {
  if (attempts >= WEBHOOK_INBOX_MAX_ATTEMPTS) {
    return { status: "failed", nextAttemptAt: null };
  }
  const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.max(0, attempts - 1)));
  return { status: "retry", nextAttemptAt: now + delay };
}

export type OrderWebhookIngestionResult = {
  httpStatus: 200 | 500;
  body:
    | { ok: true; deduped: boolean; discarded: boolean }
    | { error: "falha ao persistir evento" };
};

export async function ingestOrderWebhook(
  repository: WebhookInboxRepository,
  input: {
    storeId: string;
    event: OrderWebhookEvent;
    resourceId: string;
  },
  now = Date.now(),
): Promise<OrderWebhookIngestionResult> {
  try {
    const result = await repository.receive({
      ...input,
      key: eventKey(input.event, input.resourceId),
      receivedAt: now,
    });
    return {
      httpStatus: 200,
      body: {
        ok: true,
        deduped: result === "duplicate",
        discarded: result === "discarded",
      },
    };
  } catch {
    return {
      httpStatus: 500,
      body: { error: "falha ao persistir evento" },
    };
  }
}
