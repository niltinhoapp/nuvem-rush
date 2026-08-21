import type { Cart, Contact, Enrollment, Order, OrderItem } from "@/types";
import type { LgpdWebhook } from "./model";

export const DATA_REQUEST_DELIVERY_STATUS = "DELIVERY_PENDING_AUTHENTICATED_DASHBOARD_ACCESS" as const;

export type DataRequestEvidence = {
  requestId: string;
  type: "customers/data_request";
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  receivedAt: number;
  updatedAt: number;
  processingAt?: number;
  leaseId?: string;
  generatedAt?: number;
  completedAt?: number;
  errorCode?: string;
  affected?: Record<string, number>;
  customerKeyHashes?: string[];
  dataRequestId?: string;
  compileStatus?: "pending" | "processing" | "completed" | "failed";
  deliveryStatus?: "pending" | "delivered";
  deliveryMethod?: "dashboard";
  delivered?: boolean;
  deliveredAt?: number;
  accessCount?: number;
};

export type DataRequestDashboardItem = {
  requestId: string;
  receivedAt: number;
  compileStatus: "pending" | "processing" | "completed" | "failed";
  deliveryStatus: "pending" | "delivered";
  deliveredAt?: number;
};

export type DataRequestContact = Pick<
  Contact,
  | "contactId"
  | "nsCustomerId"
  | "name"
  | "email"
  | "phone"
  | "tags"
  | "ordersCount"
  | "totalSpent"
  | "optOut"
  | "lastOrderAt"
>;

export type DataRequestOrder = Pick<
  Order,
  | "orderId"
  | "nsOrderId"
  | "total"
  | "items"
  | "status"
  | "paidAt"
  | "fulfilledAt"
  | "shippingStatus"
  | "trackingCode"
  | "trackingUrl"
>;

export type DataRequestCart = Pick<
  Cart,
  "cartId" | "total" | "items" | "recoveryUrl" | "createdAt" | "abandonedAt" | "status"
>;

export type DataRequestEnrollment = Pick<
  Enrollment,
  "enrollmentId" | "flowId" | "orderId" | "cartId" | "status" | "startedAt"
>;

export type MessagingSummary = {
  channel: string;
  sent: number;
  scheduled: number;
  failed: number;
  cancelled: number;
};

export type DataRequestExport = {
  requestId: string;
  storeId: string;
  generatedAt: number;
  contact: DataRequestContact | null;
  orders: DataRequestOrder[];
  carts: DataRequestCart[];
  enrollments: DataRequestEnrollment[];
  messagingSummary: MessagingSummary[];
};

export interface DataRequestRepository {
  begin(payload: LgpdWebhook, now: number): Promise<
    | { action: "process"; evidence: DataRequestEvidence }
    | { action: "duplicate"; evidence: DataRequestEvidence }
  >;
  compile(
    payload: LgpdWebhook,
    evidence: DataRequestEvidence,
    now: number,
  ): Promise<DataRequestExport>;
  complete(
    payload: LgpdWebhook,
    evidence: DataRequestEvidence,
    compiled: DataRequestExport,
    now: number,
  ): Promise<void>;
  fail(
    payload: LgpdWebhook,
    evidence: DataRequestEvidence,
    errorCode: string,
    now: number,
  ): Promise<void>;
}

function sanitizeDataRequestError(error: unknown): string {
  const code = error instanceof Error ? error.message : "unknown";
  return new Set([
    "lgpd_store_not_found",
    "lgpd_customer_identifier_missing",
    "lgpd_customer_ambiguous",
    "lgpd_data_request_in_progress",
    "lgpd_data_request_lease_lost",
  ]).has(code) ? code : "lgpd_data_request_failed";
}

export type DataRequestResult =
  | { ok: true; deduped: true; export: null }
  | { ok: true; deduped: false; export: DataRequestExport };

export async function processDataRequest(
  repository: DataRequestRepository,
  payload: LgpdWebhook,
  now: number = Date.now(),
): Promise<DataRequestResult> {
  if (payload.event !== "customers/data_request") {
    throw new Error("lgpd_data_request_invalid_event");
  }
  const claim = await repository.begin(payload, now);
  if (claim.action === "duplicate") return { ok: true, deduped: true, export: null };

  try {
    // O export existe somente em memoria. O dashboard autenticado recompila
    // sob demanda; este processamento do webhook nao entrega nem persiste PII.
    const compiled = await repository.compile(payload, claim.evidence, now);
    await repository.complete(payload, claim.evidence, compiled, now);
    return { ok: true, deduped: false, export: compiled };
  } catch (error) {
    await repository.fail(payload, claim.evidence, sanitizeDataRequestError(error), now);
    throw error;
  }
}

export function sanitizeOrderItems(items: OrderItem[] | undefined): OrderItem[] {
  return (items ?? []).map((item) => ({
    sku: item.sku ?? null,
    productId: item.productId ?? null,
    categoryIds: [...(item.categoryIds ?? [])],
    brand: item.brand ?? null,
    qty: Number(item.qty ?? 0),
    price: Number(item.price ?? 0),
  }));
}
