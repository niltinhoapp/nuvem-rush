// Ingestão do SINAL de carrinho do módulo NubeSDK (Web Worker, storefront).
//
// SEGURANÇA — sinal UNTRUSTED. Autoridade server-side:
// - storeId/storeDomain/cartId do cliente são UNTRUSTED;
// - a loja reivindicada precisa existir e estar ativa (checagem A);
// - VÍNCULO ORIGIN↔LOJA (checagem D): a Origin precisa bater com os domínios
//   legítimos DAQUELA loja (GET /store, cacheados). Não basta ser "alguma" loja
//   Nuvemshop. Enquanto os domínios não estão cacheados (cold-start), exige ao
//   menos origem Nuvemshop; a confirmação definitiva (posse do checkout) ocorre
//   no cron via API oficial;
// - relógio do servidor (receivedAt); terminal não regride (transação);
// - identidade Firestore store-scoped + hash do cartId (sem colisão);
// - NÃO envia mensagem, NÃO acessa dado privado, NÃO altera pedido/loja.
import { NextRequest, NextResponse } from "next/server";
import { db, storeRef, col } from "@/lib/firebase/admin";
import { corsHeadersFor, isAllowedOrigin } from "@/lib/storefront/cors";
import { parseCartSignal } from "@/lib/storefront/cartSignal";
import { reduceSignalDoc, type SignalDoc } from "@/lib/storefront/signalDoc";
import { cartKeyHash } from "@/lib/storefront/cartKey";
import { originMatchesStore, hasKnownDomains } from "@/lib/storefront/tenantOrigin";
import type { Store } from "@/types";

// Preflight reflete a origem (o POST é que valida tenant-origin).
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeadersFor(origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "json invalido" }, { status: 400, headers: cors });
  }
  const parsed = parseCartSignal(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "payload invalido", detail: parsed.error }, { status: 400, headers: cors });
  }
  const { storeId, cartId, phase } = parsed.data;

  // (A) loja reivindicada existe e está ativa.
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active") {
    return NextResponse.json({ error: "loja invalida" }, { status: 403, headers: cors });
  }

  // (D) vínculo Origin↔loja.
  if (hasKnownDomains(store)) {
    if (!originMatchesStore(origin, store)) {
      return NextResponse.json({ error: "origin nao corresponde a loja" }, { status: 403, headers: cors });
    }
  } else if (!isAllowedOrigin(origin)) {
    // cold-start (domínios ainda não cacheados): exige origem Nuvemshop.
    return NextResponse.json({ error: "origem nao permitida" }, { status: 403, headers: cors });
  }

  // Identidade store-scoped + hash do cartId (guarda o cartId original no doc).
  const receivedAt = Date.now();
  const ref = col(storeId, "cart_signals").doc(cartKeyHash(cartId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as SignalDoc) : null;
    const nextDoc = reduceSignalDoc(existing, { storeId, cartId, phase, receivedAt });
    tx.set(ref, nextDoc);
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}
