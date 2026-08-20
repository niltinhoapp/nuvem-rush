// Ingestão do SINAL de carrinho do módulo NubeSDK (Web Worker, storefront).
//
// SEGURANÇA — sinal UNTRUSTED, TENANT-BOUND antes de qualquer efeito:
// - storeId/storeDomain/cartId do cliente são UNTRUSTED;
// - (A) a loja reivindicada precisa existir, estar ativa e ter access token;
// - (D) VÍNCULO ORIGIN↔LOJA obrigatório ANTES de gravar/renovar o sinal: a
//   Origin é validada contra os domínios LEGÍTIMOS daquela loja. Os domínios
//   vêm do cache SÓ se fresco; senão de GET /store server-side (fonte de
//   verdade). Se GET /store falhar e não houver cache fresco -> FAIL CLOSED.
//   Sufixo genérico Nuvemshop NUNCA prova pertencer àquela loja;
// - relógio do servidor (receivedAt); terminal não regride; identidade
//   store-scoped + hash do cartId; NÃO envia/nao lê dado privado/nao altera loja.
import { NextRequest, NextResponse } from "next/server";
import { db, storeRef, col } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { corsHeadersFor } from "@/lib/storefront/cors";
import { parseCartSignal } from "@/lib/storefront/cartSignal";
import { reduceSignalDoc, type SignalDoc } from "@/lib/storefront/signalDoc";
import { cartKeyHash } from "@/lib/storefront/cartKey";
import { originMatchesStore, isDomainsCacheFresh, type StoreDomains } from "@/lib/storefront/tenantOrigin";
import type { Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

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

  // (A) loja existe, ativa e com token.
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active" || !store.accessToken) {
    return NextResponse.json({ error: "loja invalida" }, { status: 403, headers: cors });
  }

  // (D) domínios confiáveis da loja: cache fresco OU GET /store server-side.
  const now = Date.now();
  let domains: StoreDomains = { domains: store.domains, originalDomain: store.originalDomain };
  if (!isDomainsCacheFresh(store.domainsRefreshedAt, now)) {
    try {
      const info = await new NuvemshopClient(storeId, store.accessToken).getStore();
      domains = { domains: info.domains ?? [], originalDomain: info.original_domain };
      await db.runTransaction(async (tx) => {
        const currentStore = await tx.get(storeRef(storeId));
        if (!isStoreCommerciallyActive(currentStore.data()?.status)) return;
        tx.set(storeRef(storeId), { ...domains, domainsRefreshedAt: now }, { merge: true });
      })
        .catch(() => {}); // cache é otimização; falha ao persistir não bloqueia
    } catch {
      // FAIL CLOSED: sem cache fresco e GET /store falhou -> rejeita o sinal.
      return NextResponse.json({ error: "nao foi possivel validar a loja" }, { status: 403, headers: cors });
    }
  }

  // Origin precisa bater EXATAMENTE com os domínios DAQUELA loja.
  if (!originMatchesStore(origin, domains)) {
    return NextResponse.json({ error: "origin nao corresponde a loja" }, { status: 403, headers: cors });
  }

  // Só aqui, tenant-bound confirmado, gravamos/renovamos o sinal.
  const receivedAt = Date.now();
  const ref = col(storeId, "cart_signals").doc(cartKeyHash(cartId));
  await db.runTransaction(async (tx) => {
    const [currentStore, snap] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    if (!isStoreCommerciallyActive(currentStore.data()?.status)) {
      throw new Error("store_inactive");
    }
    const existing = snap.exists ? (snap.data() as SignalDoc) : null;
    const nextDoc = reduceSignalDoc(existing, { storeId, cartId, phase, receivedAt });
    tx.set(ref, nextDoc);
  });

  return NextResponse.json({ ok: true }, { headers: cors });
}
