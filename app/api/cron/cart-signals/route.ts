// Cron: converte sinais de checkout em inscrição de recuperação APÓS timeout de
// inatividade — decisão 100% SERVER-SIDE. Protegido por CRON_SECRET. Freq: */5.
//
// - Loja DONA resolvida pela API oficial (a que retorna o checkout id) — o
//   storeId do cliente nunca é usado (bloqueador 1);
// - abandono usa lastActivityAt do SERVIDOR (bloqueador 4/5);
// - conclusão confirmada server-side: se o checkout saiu da lista de abandonados
//   (completed_at) -> terminal; nunca encerra por COMPLETED do browser (bloq. 2);
// - status terminal é setado atomicamente e não regride (bloqueador 3);
// - inscrição deduplicada/segura via enrollCartOnce (bloqueador 6).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { syncAbandonedCheckout } from "@/lib/nuvemshop/carts";
import { enrollCartOnce } from "@/lib/storefront/enrollCartOnce";
import { isAbandonedServer, type SignalDoc } from "@/lib/storefront/signalDoc";
import type { NsCheckout } from "@/lib/nuvemshop/types";
import type { Store } from "@/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const now = Date.now();
  const stores = await db.collection("stores").where("status", "==", "active").get();

  let matched = 0;
  let enrolled = 0;

  for (const storeDoc of stores.docs) {
    const store = storeDoc.data() as Store;
    if (!store.accessToken) continue;

    let checkouts: NsCheckout[] = [];
    try {
      checkouts = await new NuvemshopClient(storeDoc.id, store.accessToken).listCheckouts();
    } catch {
      continue;
    }

    for (const raw of checkouts) {
      if (raw.completed_at) continue; // concluído -> não é abandonado
      const cartId = String(raw.id);

      // Só age se HÁ sinal para este checkout (o SDK viu atividade real aqui).
      const sigRef = db.collection("cart_signals").doc(cartId);
      const sigSnap = await sigRef.get();
      if (!sigSnap.exists) continue;
      const doc = sigSnap.data() as SignalDoc;

      // Esta loja é a DONA (a API dela retornou o checkout) — bloqueador 1.
      // Abandono decidido só com dados do servidor — bloqueador 4/5.
      if (!isAbandonedServer(doc, now)) continue;
      matched++;

      // Reivindica o sinal atomicamente: só um worker/cron o marca terminal.
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(sigRef);
        const d = s.exists ? (s.data() as SignalDoc) : null;
        if (!d || d.status === "terminal" || !isAbandonedServer(d, now)) return false;
        tx.set(sigRef, { ...d, status: "terminal", terminalReason: "enrolled" }, { merge: true });
        return true;
      });
      if (!claimed) continue;

      const { cart, contact } = await syncAbandonedCheckout(storeDoc.id, raw);
      const did = await enrollCartOnce(storeDoc.id, cart, contact); // dedup c/ polling
      if (did) enrolled++;
    }
  }

  return NextResponse.json({ ok: true, stores: stores.size, matched, enrolled });
}
