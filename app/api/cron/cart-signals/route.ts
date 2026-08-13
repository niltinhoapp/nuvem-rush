// Cron: promove sinais de checkout a inscrição, com decisão 100% SERVER-SIDE.
// Protegido por CRON_SECRET. Freq: */5.
//
// - identidade store-scoped: stores/{storeId}/cart_signals/{hash(cartId)}
//   (collectionGroup para varrer só quem tem sinais);
// - valida DIRETO a loja reivindicada (existe/ativa/token) e confirma via API
//   oficial que o cartId é um checkout abandonado real (bloqueador 1);
// - cacheia os domínios da loja (GET /store) para o vínculo Origin↔loja do
//   endpoint (bloqueador 3), server-side, sem tocar no OAuth;
// - LEASE com FENCING: pending -> processing{leaseId} -> terminal SÓ após
//   sync+enroll; só quem detém o leaseId finaliza/libera (bloqueador 1/2).
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, storeRef } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { syncAbandonedCheckout } from "@/lib/nuvemshop/carts";
import { enrollCartOnce } from "@/lib/storefront/enrollCartOnce";
import { isAbandonedServer, canClaimSignal, canFinalizeSignal, type SignalDoc } from "@/lib/storefront/signalDoc";
import type { NsCheckout } from "@/lib/nuvemshop/types";
import type { Store } from "@/types";

export const maxDuration = 60;
const LIMIT = 500;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();

  // Sinais candidatos (subcoleções store-scoped) via collectionGroup.
  const [pend, proc] = await Promise.all([
    db.collectionGroup("cart_signals").where("status", "==", "pending").limit(LIMIT).get(),
    db.collectionGroup("cart_signals").where("status", "==", "processing").limit(LIMIT).get(),
  ]);
  const candidates = [...pend.docs, ...proc.docs].filter((d) => {
    const s = d.data() as SignalDoc;
    return isAbandonedServer(s, now) && canClaimSignal(s.status, s.leaseAt, now);
  });

  const byStore = new Map<string, typeof candidates>();
  for (const d of candidates) {
    const storeId = (d.data() as SignalDoc).storeId;
    const arr = byStore.get(storeId);
    if (arr) arr.push(d);
    else byStore.set(storeId, [d]);
  }

  let confirmed = 0;
  let enrolled = 0;

  for (const [storeId, sigs] of byStore) {
    const store = (await storeRef(storeId).get()).data() as Store | undefined;
    if (!store || store.status !== "active" || !store.accessToken) continue;

    let checkouts: NsCheckout[] = [];
    try {
      checkouts = await new NuvemshopClient(storeId, store.accessToken).listCheckouts();
    } catch {
      continue;
    }
    const byId = new Map(checkouts.map((c) => [String(c.id), c]));

    for (const sigDoc of sigs) {
      const sig = sigDoc.data() as SignalDoc;
      const raw = byId.get(sig.cartId);
      if (!raw || raw.completed_at) continue; // API não confirma abandono real
      confirmed++;

      // LEASE com FENCING: pending/stale -> processing{leaseId}.
      const leaseId = randomUUID();
      const leased = await db.runTransaction(async (tx) => {
        const s = await tx.get(sigDoc.ref);
        const d = s.exists ? (s.data() as SignalDoc) : null;
        if (!d || !isAbandonedServer(d, now) || !canClaimSignal(d.status, d.leaseAt, now)) return false;
        tx.set(sigDoc.ref, { ...d, status: "processing", leaseAt: now, leaseId }, { merge: true });
        return true;
      });
      if (!leased) continue;

      try {
        const { cart, contact } = await syncAbandonedCheckout(storeId, raw);
        const did = await enrollCartOnce(storeId, cart, contact);
        // Terminal SÓ após concluir, e SÓ se ainda detemos o lease (fencing).
        await db.runTransaction(async (tx) => {
          const s = await tx.get(sigDoc.ref);
          const d = s.exists ? (s.data() as SignalDoc) : null;
          if (d && canFinalizeSignal(d, leaseId)) {
            tx.set(sigDoc.ref, { status: "terminal", terminalReason: did ? "enrolled" : "deduped" }, { merge: true });
          }
        });
        if (did) enrolled++;
      } catch {
        // Falha -> libera o lease (fencing) para retry. Se perdemos o lease, no-op.
        await db.runTransaction(async (tx) => {
          const s = await tx.get(sigDoc.ref);
          const d = s.exists ? (s.data() as SignalDoc) : null;
          if (d && canFinalizeSignal(d, leaseId)) {
            tx.set(sigDoc.ref, { status: "pending", leaseAt: null, leaseId: null }, { merge: true });
          }
        });
      }
    }
  }

  return NextResponse.json({ ok: true, candidates: candidates.length, confirmed, enrolled });
}
