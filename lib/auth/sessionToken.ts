// Validacao do session token do Nexo (JWT HS256 assinado com o Client Secret).
// O payload identifica a loja logada no admin da Nuvemshop.
import { createHmac, timingSafeEqual } from "node:crypto";

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export interface SessionClaims {
  storeId: string;
  raw: Record<string, unknown>;
}

// Retorna as claims se o token for valido (assinatura + expiracao), senao null.
export function verifySessionToken(token: string): SessionClaims | null {
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!secret?.trim()) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  // Confere a assinatura HS256.
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlDecode(signatureB64!);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64!).toString("utf8"));
  } catch {
    return null;
  }

  // Expiracao (exp em segundos).
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  // Confirmado via inspecao de um token real (ver stores/_debug):
  // o claim correto e "storeId" (camelCase). "sub" e outra coisa (parece
  // ser o user_id do lojista logado, nao a loja) — NAO usar como id de loja.
  // Mantemos store_id como fallback de compatibilidade, mas sub fica de fora.
  const storeRaw = payload.storeId ?? payload.store_id;
  if (storeRaw == null) return null;

  return { storeId: String(storeRaw), raw: payload };
}
