// Registra o sinal comercial PROVADO (webhook app/suspended|resumed, ou um
// HTTP 402 observado numa chamada real ja feita a Nuvemshop) na cache
// operacional do doc raiz da store. Nunca inventa estado: so grava o que foi
// de fato observado, quando foi observado.
//
// Ver lib/billing/policy.ts para o porque desta ser a UNICA fonte de
// verdade documentada (nao ha endpoint provado de leitura de subscription
// por store).
import { db, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import type { StoreCommercialCache } from "./policy";

// Chamado por: app/api/webhooks/nuvemshop/route.ts (app/suspended|resumed —
// sinal documentado e imediato) e pelos pontos que ja fazem chamadas reais
// autenticadas a Nuvemshop com o token da loja (lib/nuvemshop/sync.ts no
// order sync, app/api/cron/carts/route.ts no poll diario, o callback OAuth
// apos registrar webhooks) — um 200 real ou um 402 real observado la.
//
// Idempotente por natureza (so sobrescreve com o timestamp mais recente);
// nao ha necessidade de dedup — reprocessar o mesmo sinal so regrava o
// mesmo resultado. Loja com lifecycle inativo (uninstalled/redacting/
// redacted) nunca e tocada, mesmo que o sinal chegue depois da purga.
export async function recordBillingAccessSignal(
  storeId: string,
  blocked: boolean,
  now: number = Date.now(),
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = storeRef(storeId);
    const current = await tx.get(ref);
    if (!current.exists || !isStoreCommerciallyActive(current.data()?.status)) return;
    tx.set(ref, { billingBlocked: blocked, commercialSyncedAt: now }, { merge: true });
  });
}

// Leitura pura da cache comercial gravada no doc raiz da store — usada pelos
// gates (via resolveStoreCommercialState) e pela API de status. Nunca inicia
// nada; so le o que ja esta la.
export async function getStoreCommercialCache(storeId: string): Promise<StoreCommercialCache | null> {
  const snap = await storeRef(storeId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    billingBlocked: data?.billingBlocked === true,
    commercialSyncedAt: typeof data?.commercialSyncedAt === "number" && Number.isFinite(data.commercialSyncedAt)
      ? data.commercialSyncedAt
      : undefined,
  };
}
