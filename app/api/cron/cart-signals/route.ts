// Cron: promove sinais de checkout a inscrição de recuperação, com decisão 100%
// SERVER-SIDE. Protegido por CRON_SECRET. Freq: */5.
//
// Bloqueador 1 (identidade): o sinal é signal-driven e store-scoped. Para cada
// sinal, valida DIRETAMENTE a loja reivindicada (existe/ativa/tem token) e
// confirma via API oficial daquela loja que o cartId é um checkout abandonado
// real. Só então promove. storeId/cartId do cliente nunca selecionam outra loja;
// duas lojas com o mesmo cartId não colidem (chave composta).
//
// Bloqueador 2 (lease): pending -> processing (lease) -> terminal SÓ após
// sync+enroll concluírem (sucesso ou dedup). Falha volta a pending (retry).
// Worker morto deixa "processing" com lease vencido, recuperável depois.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { syncAbandonedCheckout } from "@/lib/nuvemshop/carts";
import { enrollCartOnce } from "@/lib/storefront/enrollCartOnce";
import { isAbandonedServer, canClaimSignal, type SignalDoc } from "@/lib/storefront/signalDoc";
import type { NsCheckout } from "@/lib/nuvemshop/types";
import type { Store } from "@/types";

export const maxDuration = 60;
const LIMIT = 500;

type SigRef = FirebaseFirestore.QueryDocumentSnapshot;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();

  // Candidatos: pending + processing com lease vencido (recuperação).
  const [pend, proc] = await Promise.all([
    db.collection("cart_signals").where("status", "==", "pending").limit(LIMIT).get(),
    db.collection("cart_signals").where("status", "==", "processing").limit(LIMIT).get(),
  ]);
  const candidates = [...pend.docs, ...proc.docs].filter((d) => {
    const s = d.data() as SignalDoc;
    return isAbandonedServer(s, now) && canClaimSignal(s.status, s.leaseAt, now);
  });

  // Agrupa por loja REIVINDICADA (validada abaixo).
  const byStore = new Map<string, SigRef[]>();
  for (const d of candidates) {
    const s = d.data() as SignalDoc;
    const arr = byStore.get(s.storeId) ?? [];
    arr.push(d);
    byStore.set(s.storeId, arr);
  }

  let confirmed = 0;
  let enrolled = 0;

  for (const [storeId, sigs] of byStore) {
    // Validação DIRETA da loja reivindicada (sem varrer todas as lojas).
    const storeSnap = await db.collection("stores").doc(storeId).get();
    const store = storeSnap.exists ? (storeSnap.data() as Store) : undefined;
    if (!store || store.status !== "active" || !store.accessToken) continue; // não confirma -> não processa

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

      // LEASE atômico: pending/stale-processing -> processing.
      const leased = await db.runTransaction(async (tx) => {
        const s = await tx.get(sigDoc.ref);
        const d = s.exists ? (s.data() as SignalDoc) : null;
        if (!d || !isAbandonedServer(d, now) || !canClaimSignal(d.status, d.leaseAt, now)) return false;
        tx.set(sigDoc.ref, { ...d, status: "processing", leaseAt: now }, { merge: true });
        return true;
      });
      if (!leased) continue;

      try {
        const { cart, contact } = await syncAbandonedCheckout(storeId, raw);
        const did = await enrollCartOnce(storeId, cart, contact);
        // Terminal SÓ após concluir: enrolled (inscreveu) ou deduped (outro caminho já).
        await sigDoc.ref.set(
          { status: "terminal", terminalReason: did ? "enrolled" : "deduped" },
          { merge: true },
        );
        if (did) enrolled++;
      } catch {
        // Falha em sync/enroll -> volta a pending (retry num próximo ciclo).
        await sigDoc.ref.set({ status: "pending", leaseAt: null }, { merge: true });
      }
    }
  }

  return NextResponse.json({ ok: true, candidates: candidates.length, confirmed, enrolled });
}
