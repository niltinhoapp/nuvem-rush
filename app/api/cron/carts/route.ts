// Cron da Vercel: varre carrinhos abandonados (Abandoned Checkout) das lojas
// ativas e inscreve os NOVOS em fluxos com gatilho "cart_abandoned".
// Nao ha webhook de carrinho na Nuvemshop, entao fazemos poll.
// Protegido pelo CRON_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { syncAbandonedCheckout } from "@/lib/nuvemshop/carts";
import { enrollCartOnce } from "@/lib/storefront/enrollCartOnce";
import type { NsCheckout } from "@/lib/nuvemshop/types";
import type { Store } from "@/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Fail-closed: sem CRON_SECRET configurado, recusa (nao expoe o cron).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const stores = await db.collection("stores").where("status", "==", "active").get();

  let scanned = 0;
  let novos = 0;

  for (const storeDoc of stores.docs) {
    const store = storeDoc.data() as Store;
    if (!store.accessToken) continue;

    let checkouts: NsCheckout[] = [];
    try {
      const client = new NuvemshopClient(storeDoc.id, store.accessToken);
      checkouts = await client.listCheckouts();
    } catch {
      continue; // loja com token invalido / sem escopo: pula
    }

    for (const raw of checkouts) {
      if (raw.completed_at) continue; // ja finalizou a compra -> nao e abandonado
      scanned++;

      // NAO usar "doc do carrinho existe" como prova de inscricao (bloqueador 2):
      // o enrollCartOnce e a autoridade (lease enrolling->enrolled). sync e
      // idempotente (merge); se antes sincronizou mas a inscricao falhou, o lease
      // expirou e este poll retoma. Dedup atomico compartilhado com o sinal.
      const { cart, contact } = await syncAbandonedCheckout(storeDoc.id, raw); // synced
      const did = await enrollCartOnce(storeDoc.id, cart, contact); // enrolled (ou dedup)
      if (did) novos++;
    }
  }

  return NextResponse.json({ ok: true, stores: stores.size, scanned, novos });
}
