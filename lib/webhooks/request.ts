import { verifyHmac } from "@/lib/nuvemshop/webhooks";

export type MinimalWebhookPayload = Record<string, unknown> & {
  event: string;
  store_id: string | number;
  id?: string | number;
};

export type ParsedWebhookRequest =
  | { ok: true; payload: MinimalWebhookPayload }
  | { ok: false; status: 400 | 401; error: "assinatura invalida" | "payload invalido" };

export function parseSignedWebhookRequest(
  rawBody: string,
  signature: string | null,
): ParsedWebhookRequest {
  if (!verifyHmac(rawBody, signature)) {
    return { ok: false, status: 401, error: "assinatura invalida" };
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "payload invalido" };
  }

  if (!value || typeof value !== "object") {
    return { ok: false, status: 400, error: "payload invalido" };
  }
  const payload = value as Record<string, unknown>;
  const storeId = payload.store_id;
  const validStoreId =
    (typeof storeId === "string" && storeId.trim().length > 0)
    || (typeof storeId === "number" && Number.isFinite(storeId));
  if (typeof payload.event !== "string" || !validStoreId) {
    return { ok: false, status: 400, error: "payload invalido" };
  }

  return { ok: true, payload: payload as MinimalWebhookPayload };
}
