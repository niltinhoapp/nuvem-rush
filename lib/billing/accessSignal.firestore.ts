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
import { NuvemshopClient, NuvemshopApiError } from "@/lib/nuvemshop/client";
import {
  resolveStoreCommercialState,
  FINAL_GUARD_FRESHNESS_MS,
  type StoreCommercialCache,
  type CommercialState,
} from "./policy";

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

// Guarda IMEDIATAMENTE ANTES de um efeito comercial externo real (enviar
// WhatsApp/e-mail, disparar webhook). Nunca autoriza so com base na cache de
// 26h: exige um sinal visto ha no maximo FINAL_GUARD_FRESHNESS_MS (5 min);
// se nao houver, faz um probe minimo `GET /store` (o endpoint oficial mais
// barato ja usado neste repo para outros fins, com o access_token da propria
// loja) e interpreta a resposta com o MESMO contrato documentado das outras
// chamadas reais: 200 = acesso concedido agora; 402 = bloqueado (pagamento
// OU dias gratis esgotados — o doc nao distingue); qualquer outra coisa
// (timeout, 5xx, corpo malformado, erro de rede) e ambigua — fail-closed
// para billing_unknown SEM gravar nenhum sinal (nunca um chute).
//
// `fetchImpl` e injetavel so para teste (fake HTTP) — nunca chamado com a
// API real nesta OS.
export async function ensureFreshCommercialAccess(
  storeId: string,
  accessToken: string,
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<CommercialState> {
  const cache = await getStoreCommercialCache(storeId);
  const freshEnough = typeof cache?.commercialSyncedAt === "number"
    && Number.isFinite(cache.commercialSyncedAt)
    && Number.isFinite(now)
    && now - cache.commercialSyncedAt <= FINAL_GUARD_FRESHNESS_MS;
  if (freshEnough) return resolveStoreCommercialState(cache!, now);

  const client = new NuvemshopClient(storeId, accessToken, { fetchImpl });
  try {
    await client.getStore();
    await recordBillingAccessSignal(storeId, false, now);
    return "commercial_access_active";
  } catch (error) {
    if (error instanceof NuvemshopApiError && error.status === 402) {
      await recordBillingAccessSignal(storeId, true, now);
      return "commercial_access_blocked";
    }
    return "billing_unknown";
  }
}
