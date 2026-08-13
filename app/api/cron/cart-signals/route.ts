// Cron: converte sinais de "checkout iniciado" (do NubeSDK) em inscrição de
// recuperação APÓS o timeout de inatividade — a decisão de abandono é
// SERVER-SIDE (o worker morre ao fechar a aba). Reconfirma via API oficial
// antes de inscrever e deduplica com o polling via enrollCartOnce.
//
// Protegido por CRON_SECRET (mesmo padrão do dispatch). Frequência: */5.
import { NextRequest, NextResponse } from "next/server";
import { db, col } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { syncAbandonedCheckout } from "@/lib/nuvemshop/carts";
import { enrollCartOnce } from "@/lib/storefront/enrollCartOnce";
import { isAbandonedCandidate } from "@/lib/storefront/cartState";
import type { NsCheckout } from "@/lib/nuvemshop/types";
import type { Store } from "@/types";

export const maxDuration = 60;
const PER_STORE_LIMIT = 500;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();
  const stores = await db.collection("stores").where("status", "==", "active").get();

  let candidates = 0;
  let enrolled = 0;

  for (const storeDoc of stores.docs) {
    const store = storeDoc.data() as Store;
    if (!store.accessToken) continue;

    const sigs = await col(storeDoc.id, "cart_signals")
      .where("status", "==", "checkout_started")
      .limit(PER_STORE_LIMIT)
      .get();
    if (sigs.empty) continue;

    // Só consulta a API se houver algum candidato por timeout.
    const due = sigs.docs.filter((d) => {
      const s = d.data() as { lastEventAt: number };
      return isAbandonedCandidate("CHECKOUT_STARTED", s.lastEventAt, now, false);
    });
    if (due.length === 0) continue;
    candidates += due.length;

    let checkouts: NsCheckout[] = [];
    try {
      checkouts = await new NuvemshopClient(storeDoc.id, store.accessToken).listCheckouts();
    } catch {
      continue; // token inválido / sem escopo: tenta no próximo ciclo
    }
    const byId = new Map(checkouts.map((c) => [String(c.id), c]));

    for (const d of due) {
      const s = d.data() as { cartId: string; lastEventAt: number };
      const raw = byId.get(s.cartId);

      // Reconfirmação via API oficial: precisa existir e NÃO estar concluído.
      // Se não achou (id do SDK pode diferir do id do checkout — ver docs) ou já
      // concluído, encerra este sinal; o polling diário continua como fallback.
      if (!raw || raw.completed_at) {
        await d.ref.set({ status: "closed" }, { merge: true });
        continue;
      }

      const { cart, contact } = await syncAbandonedCheckout(storeDoc.id, raw);
      const did = await enrollCartOnce(storeDoc.id, cart, contact); // dedup c/ polling
      await d.ref.set({ status: did ? "enrolled" : "deduped" }, { merge: true });
      if (did) enrolled++;
    }
  }

  return NextResponse.json({ ok: true, stores: stores.size, candidates, enrolled });
}
