// Validacao de webhooks da Nuvemshop via HMAC-SHA256.
// O header "x-linkedstore-hmac-sha256" contem o HMAC do corpo cru,
// assinado com o Client Secret do app.
import { createHmac, timingSafeEqual } from "node:crypto";

export const REQUIRED_WEBHOOK_EVENTS = [
  "order/created",
  "order/paid",
  "order/cancelled",
  "product/created",
  "product/updated",
  // Obrigatorios para aprovacao / LGPD:
  "app/uninstalled",
  "store/redact",
  "customers/redact",
] as const;

export function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET ?? "";
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
