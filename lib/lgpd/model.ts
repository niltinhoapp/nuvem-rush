import { createHash } from "node:crypto";
import { z } from "zod";

export const lgpdEventSchema = z.object({
  event: z.enum(["store/redact", "customers/redact", "customers/data_request"]),
  store_id: z.union([z.string(), z.number()]).transform(String),
  customer: z.object({
    id: z.union([z.string(), z.number()]).optional().transform((value) =>
      value == null ? undefined : String(value),
    ),
    email: z.string().email().optional(),
    phone: z.string().min(5).optional(),
    identification: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  orders_to_redact: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  orders_requested: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  checkouts_requested: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  drafts_orders_requested: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  data_request: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
  }).optional(),
}).strict().superRefine((payload, ctx) => {
  if (payload.event.startsWith("customers/") && !payload.customer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "customer obrigatorio", path: ["customer"] });
  }
});

export type LgpdWebhook = z.infer<typeof lgpdEventSchema>;

export function normalizeEmail(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function normalizePhone(value?: string): string | undefined {
  const normalized = value?.replace(/\D/g, "");
  return normalized && normalized.length >= 5 ? normalized : undefined;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function customerIdentityKeys(customer: LgpdWebhook["customer"]): string[] {
  if (!customer) return [];
  return [
    customer.id ? `id:${customer.id}` : undefined,
    normalizeEmail(customer.email) ? `email:${normalizeEmail(customer.email)}` : undefined,
    normalizePhone(customer.phone) ? `phone:${normalizePhone(customer.phone)}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function customerKeys(
  storeId: string,
  customer: LgpdWebhook["customer"],
): string[] {
  return [...new Set(customerIdentityKeys(customer).map((key) => digest(`${storeId}:${key}`)))];
}

// Chaves opacas usadas para recompilar data requests sem persistir os
// identificadores originais do titular. `identification` e incluido apenas
// neste lookup; o lifecycle de suppression existente permanece inalterado.
export function dataRequestCustomerKeys(
  storeId: string,
  customer: LgpdWebhook["customer"],
): string[] {
  const identification = customer?.identification == null
    ? undefined
    : String(customer.identification).trim();
  return [...new Set([
    ...customerKeys(storeId, customer),
    identification ? digest(`${storeId}:identification:${identification}`) : undefined,
  ].filter((value): value is string => Boolean(value)))];
}

export function lgpdRequestId(payload: LgpdWebhook): string {
  const subject = payload.event === "store/redact"
    ? "store"
    : payload.data_request?.id
      ? `request:${payload.data_request.id}`
      : customerIdentityKeys(payload.customer).map(digest)[0];
  if (!subject) throw new Error("lgpd_customer_identifier_missing");
  return digest(`${payload.store_id}:${payload.event}:${subject}`);
}

export function anonymousContactId(requestId: string): string {
  return `redacted:${digest(`contact:${requestId}`).slice(0, 40)}`;
}

export type LgpdRequestStatus = "pending" | "processing" | "completed" | "failed";

export type MinimalLgpdRequest = {
  requestId: string;
  type: LgpdWebhook["event"];
  storeId: string;
  status: LgpdRequestStatus;
  customerKeyHashes?: string[];
  dataRequestId?: string;
  attempts: number;
  receivedAt: number;
  updatedAt: number;
  processingAt?: number;
  leaseId?: string;
  completedAt?: number;
  errorCode?: string;
  anonymizedContactId?: string;
  affected?: Record<string, number>;
};

export function minimalRequest(
  payload: LgpdWebhook,
  now: number,
): MinimalLgpdRequest {
  const requestId = lgpdRequestId(payload);
  return {
    requestId,
    type: payload.event,
    storeId: payload.store_id,
    status: "pending",
    ...(payload.customer ? {
      customerKeyHashes: payload.event === "customers/data_request"
        ? dataRequestCustomerKeys(payload.store_id, payload.customer)
        : customerKeys(payload.store_id, payload.customer),
    } : {}),
    ...(payload.data_request?.id ? { dataRequestId: payload.data_request.id } : {}),
    ...(payload.event === "customers/redact" ? { anonymizedContactId: anonymousContactId(requestId) } : {}),
    attempts: 0,
    receivedAt: now,
    updatedAt: now,
  };
}
