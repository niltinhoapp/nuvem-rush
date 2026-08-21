// Resolve a loja (storeId) a partir da requisicao.
// Em producao: valida o session token do Nexo (Authorization: Bearer <jwt>).
// Em dev: aceita o header x-store-id como atalho.
import type { NextRequest } from "next/server";
import { verifySessionToken } from "./sessionToken";

// Resolve exclusivamente uma sessao Nexo autenticada. Nao possui fallback de
// desenvolvimento e deve ser usado por endpoints que podem retornar PII.
export function resolveAuthenticatedStoreId(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifySessionToken(auth.slice(7))?.storeId ?? null;
}

export function resolveStoreId(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return resolveAuthenticatedStoreId(req);
  }

  // Atalho de desenvolvimento (nunca confiar em producao).
  if (process.env.NODE_ENV !== "production") {
    return req.headers.get("x-store-id") ?? req.nextUrl.searchParams.get("storeId");
  }
  return null;
}
