// Sincroniza o cache comercial (Store.trialEndsAt/subscriptionStatus/
// commercialSyncedAt) a partir da fonte de verdade — o Billing nativo da
// Nuvemshop — com o trial local como fallback SOMENTE quando a Nuvemshop
// confirma que a loja nunca teve assinatura (ver policy.ts e
// trialFallback.firestore.ts).
//
// Chamado em: instalacao/reinstalacao (OAuth callback), pelo webhook
// subscription/updated (como SINAL — nunca confia no payload, sempre
// rebusca o estado canonico), e por um cron periodico que mantem a cache
// das lojas ativas dentro do TTL (ver policy.ts::COMMERCIAL_CACHE_TTL_MS).
//
// Em falha da Nuvemshop (kind "unknown"): a cache existente NAO e tocada —
// preserva o ultimo estado bom conhecido ate o TTL expirar por conta
// propria (fail-closed by staleness, nunca por sobrescrita).
import { FieldValue } from "firebase-admin/firestore";
import { db, storeRef } from "@/lib/firebase/admin";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import {
  fetchNuvemshopSubscription,
  type NuvemshopSubscriptionResult,
  type NuvemshopBillingCredentials,
} from "./nuvemshopBillingClient";
import { ensureTrialFallbackStarted, getTrialFallbackLedger } from "./trialFallback.firestore";
import {
  resolveCommercialStateFromBilling,
  type CommercialState,
  type SubscriptionSignal,
  type StoreCommercialCache,
} from "./policy";

// Leitura pura da cache comercial gravada no doc raiz da store — usada pelos
// gates e pela API de status. Nunca inicia sync nem trial; so le o que ja
// esta la (resolveStoreCommercialState decide o resto, incl. TTL).
export async function getStoreCommercialCache(storeId: string): Promise<StoreCommercialCache | null> {
  const snap = await storeRef(storeId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    trialEndsAt: typeof data?.trialEndsAt === "number" && Number.isFinite(data.trialEndsAt)
      ? data.trialEndsAt
      : undefined,
    subscriptionStatus: data?.subscriptionStatus === "active" || data?.subscriptionStatus === "inactive"
      ? data.subscriptionStatus
      : undefined,
    commercialSyncedAt: typeof data?.commercialSyncedAt === "number" && Number.isFinite(data.commercialSyncedAt)
      ? data.commercialSyncedAt
      : undefined,
  };
}

function toSignal(result: NuvemshopSubscriptionResult): SubscriptionSignal {
  if (result.kind === "found") return { kind: "found" };
  if (result.kind === "not_found") return { kind: "not_found" };
  return { kind: "unknown" };
}

export async function syncCommercialState(
  storeId: string,
  now: number = Date.now(),
  // Injetaveis so para teste (fake HTTP + credenciais fake) — nunca chamado
  // com a API real nesta OS.
  fetchFn: typeof fetch = fetch,
  credentials?: NuvemshopBillingCredentials | null,
): Promise<CommercialState> {
  const storeSnap = await storeRef(storeId).get();
  if (!storeSnap.exists || !isStoreCommerciallyActive(storeSnap.data()?.status)) {
    // Loja desinstalada/redacted: nao ha sentido em sincronizar billing para
    // ela (e a purga de store/redact ja teria limpado a cache do doc raiz).
    return "billing_unknown";
  }

  const result = credentials === undefined
    ? await fetchNuvemshopSubscription(storeId, fetchFn)
    : await fetchNuvemshopSubscription(storeId, fetchFn, credentials);
  const signal = toSignal(result);
  const suspended = storeSnap.data()?.billingSuspended === true;

  let fallbackTrialEndsAt: number | undefined;
  if (signal.kind === "not_found") {
    const existingFallback = await getTrialFallbackLedger(storeId);
    // So concede o fallback de cortesia se a loja JA tinha esse fallback (uso
    // normal, idempotente) OU se este e genuinamente o primeiro sync bem
    // sucedido dela (commercialSyncedAt ainda ausente). Uma loja que ja teve
    // um sync anterior mas NUNCA teve fallback so pode ter chegado ate aqui
    // tendo tido uma assinatura real encontrada antes (signal "found") — se
    // agora aparece not_found, a assinatura sumiu/foi cancelada; isso NUNCA
    // deve conceder um trial novo (mesmo raciocinio anti-reset do trial
    // normal, so que aplicado a transicao found -> not_found).
    const neverSyncedBefore = typeof storeSnap.data()?.commercialSyncedAt !== "number";
    if (existingFallback || neverSyncedBefore) {
      const fallback = await ensureTrialFallbackStarted(storeId, now);
      fallbackTrialEndsAt = fallback.trialEndsAt;
    }
  }

  const state = resolveCommercialStateFromBilling(signal, suspended, { trialEndsAt: fallbackTrialEndsAt }, now);

  if (state === "billing_unknown") {
    // Falha da Nuvemshop: nao sobrescreve a cache existente. O TTL cuida do
    // resto (ver resolveStoreCommercialState).
    return state;
  }

  const cachePatch: Record<string, unknown> = { commercialSyncedAt: now };
  if (state === "paid_active") {
    cachePatch.subscriptionStatus = "active";
    cachePatch.trialEndsAt = FieldValue.delete();
  } else if (state === "paid_inactive") {
    cachePatch.subscriptionStatus = "inactive";
    cachePatch.trialEndsAt = FieldValue.delete();
  } else {
    // trial_active ou trial_expired: reflete o fallback local, sem
    // subscriptionStatus (a Nuvemshop nao tem assinatura para esta loja).
    // fallbackTrialEndsAt fica undefined quando a loja perdeu uma assinatura
    // que tinha antes e nao e elegivel a um fallback novo (ver guarda acima)
    // — nesse caso a cache tambem precisa perder o trialEndsAt antigo.
    cachePatch.subscriptionStatus = FieldValue.delete();
    cachePatch.trialEndsAt = fallbackTrialEndsAt ?? FieldValue.delete();
  }

  await db.runTransaction(async (tx) => {
    const current = await tx.get(storeRef(storeId));
    if (!isStoreCommerciallyActive(current.data()?.status)) return;
    tx.set(storeRef(storeId), cachePatch, { merge: true });
  });

  return state;
}

// Sinal de suspensao/retomada por falta de pagamento (webhooks documentados
// app/suspended / app/resumed). So altera a flag; o proximo sync recalcula
// o estado combinando isso com o resultado real da Nuvemshop.
export async function setBillingSuspended(storeId: string, suspended: boolean): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = storeRef(storeId);
    const current = await tx.get(ref);
    if (!current.exists) return;
    tx.set(ref, { billingSuspended: suspended }, { merge: true });
  });
}
