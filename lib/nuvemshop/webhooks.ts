// Validacao de webhooks da Nuvemshop via HMAC-SHA256.
// O header "x-linkedstore-hmac-sha256" contem o HMAC do corpo cru,
// assinado com o Client Secret do app.
import { createHmac, timingSafeEqual } from "node:crypto";

// Webhooks operacionais registrados via API na instalacao.
// Os eventos LGPD (store/redact, customers/redact, customers/data_request)
// sao configurados no painel de Parceiros, nao aqui.
export const REQUIRED_WEBHOOK_EVENTS = [
  "order/created",
  "order/paid",
  "order/fulfilled",
  "order/cancelled",
  "product/created",
  "product/updated",
  "app/uninstalled",
] as const;

export function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET ?? "";
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
