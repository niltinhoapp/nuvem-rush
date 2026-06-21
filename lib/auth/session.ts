// Resolve a loja (storeId) a partir da requisicao.
// Em producao: valida o session token do Nexo (Authorization: Bearer <jwt>).
// Em dev: aceita o header x-store-id como atalho.
import type { NextRequest } from "next/server";
import { verifySessionToken } from "./sessionToken";

export function resolveStoreId(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const claims = verifySessionToken(auth.slice(7));
    if (claims) return claims.storeId;
    return null; // token presente porem invalido: nao cai no atalho de dev
  }

  // Atalho de desenvolvimento (nunca confiar em producao).
  if (process.env.NODE_ENV !== "production") {
    return req.headers.get("x-store-id") ?? req.nextUrl.searchParams.get("storeId");
  }
  return null;
}
