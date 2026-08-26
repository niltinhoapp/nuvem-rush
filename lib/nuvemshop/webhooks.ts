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
  "app/uninstalled",
] as const;

// Billing V1 (Nuvemshop nativo): app/suspended e app/resumed sao processados
// em app/api/webhooks/nuvemshop/route.ts, mas NAO sao auto-registrados aqui —
// assim como os eventos LGPD acima, o padrao observado neste repo (e a
// natureza destes eventos, documentados como ligados ao Billing do parceiro,
// nao a uma store isolada) e de configuracao no painel de Parceiros, nao via
// POST /webhooks por store. PORTAL_CONFIGURATION: confirmar/ativar no
// Partner Portal antes do deploy (ver relatorio da OS).
//
// subscription/updated NAO e usado (ver lib/billing/policy.ts): dependia do
// endpoint de leitura de subscription por store, cujo contrato de selecao
// por store nunca foi documentado — sem uma leitura provada, o evento nao e
// acionavel.

export function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!secret?.trim()) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
