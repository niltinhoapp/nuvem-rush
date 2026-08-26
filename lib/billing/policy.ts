// Politica comercial central (Billing V1 — Nuvemshop nativo).
//
// Fonte de verdade: Billing da Nuvemshop (GET subscriptions) + o sinal
// documentado de suspensao por falta de pagamento (app/suspended /
// app/resumed). O trial local (fallback) so entra quando a Nuvemshop
// confirma que NUNCA existiu assinatura para aquela loja+servico — nunca
// por mera ausencia de cache nosso (ver lib/billing/sync.firestore.ts).
//
// Duas camadas PURAS, ambas testaveis isoladamente:
//   1) resolveCommercialStateFromBilling — usada so pelo sync, decide o que
//      GRAVAR no cache a partir da resposta da Nuvemshop.
//   2) resolveStoreCommercialState — usada por TODOS os gates, le o cache
//      ja gravado (Store.trialEndsAt/subscriptionStatus/commercialSyncedAt)
//      e nunca confia numa leitura velha demais (TTL).
//
// Fonte de tempo: SEMPRE o `now` passado pelo chamador (server-side) — nunca
// um valor vindo do cliente/browser.

export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Cache operacional (Store.commercialSyncedAt) — nunca autoridade perpetua.
// Passado o TTL sem resync, o gate trata como billing_unknown (fail-closed),
// exceto quando o proprio trial local ainda comprovadamente nao venceu.
export const COMMERCIAL_CACHE_TTL_MS = 26 * 60 * 60 * 1000;

export type CommercialState =
  | "trial_active"
  | "trial_expired"
  | "paid_active"
  | "paid_inactive"
  | "billing_unknown";

export interface CommercialInput {
  trialEndsAt?: number;
  subscriptionStatus?: "active" | "inactive";
}

// Assinatura ativa sempre concede acesso, independente do trial (mesmo um
// trial nunca iniciado/expirado). Sem assinatura ativa, o acesso depende
// exclusivamente do trial ainda nao ter vencido. Uma vez expirado, nao ha
// caminho de volta a trial_active — so uma assinatura paga muda o estado.
export function resolveCommercialState(input: CommercialInput, now: number): CommercialState {
  if (input.subscriptionStatus === "active") return "paid_active";
  if (
    Number.isFinite(now)
    && typeof input.trialEndsAt === "number"
    && Number.isFinite(input.trialEndsAt)
    && now < input.trialEndsAt
  ) return "trial_active";
  if (input.subscriptionStatus === "inactive") return "paid_inactive";
  return "trial_expired";
}

export interface StoreCommercialCache extends CommercialInput {
  commercialSyncedAt?: number;
}

// Usada por TODOS os gates (dispatch, ativacao de flow, criacao de
// enrollment/job, teste de WhatsApp). Cache ausente/velha demais nunca
// concede paid_active/paid_inactive "herdado" as cegas — so cai de volta
// para trial_active se o proprio trial local ainda genuinamente nao venceu
// (evita punir uma store cujo primeiro sync ainda nao rodou); caso
// contrario, billing_unknown (fail-closed).
export function resolveStoreCommercialState(store: StoreCommercialCache, now: number): CommercialState {
  const synced = store.commercialSyncedAt;
  const stale = typeof synced !== "number" || !Number.isFinite(synced)
    || !Number.isFinite(now) || now - synced > COMMERCIAL_CACHE_TTL_MS;
  if (stale) {
    if (
      Number.isFinite(now)
      && typeof store.trialEndsAt === "number"
      && Number.isFinite(store.trialEndsAt)
      && now < store.trialEndsAt
    ) return "trial_active";
    return "billing_unknown";
  }
  return resolveCommercialState(store, now);
}

// billing_unknown bloqueia efeito comercial (provider) mas os chamadores
// continuam livres para permitir leitura/configuracao — essa funcao so
// decide o gate de EFEITO real, nunca o de leitura.
export function isCommercialAccessGranted(state: CommercialState): boolean {
  return state === "trial_active" || state === "paid_active";
}

export function trialDaysRemaining(trialEndsAt: number | undefined, now: number): number {
  if (!Number.isFinite(now) || typeof trialEndsAt !== "number" || !Number.isFinite(trialEndsAt)) return 0;
  return Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)));
}

// --- Camada de sincronizacao (usada so por sync.firestore.ts) ---

export type SubscriptionSignal = { kind: "found" } | { kind: "not_found" } | { kind: "unknown" };

export interface LocalTrialFallback {
  trialEndsAt?: number;
}

// `subscriptionFound` = existe (ou existiu) registro de assinatura na
// Nuvemshop para esta loja+servico. `suspended` = ultimo sinal conhecido de
// app/suspended sem app/resumed desde entao. O resto (dias gratis, cobranca
// em si) e resolvido inteiramente pela Nuvemshop — nao replicamos aqui.
export function resolveCommercialStateFromBilling(
  billing: SubscriptionSignal,
  suspended: boolean,
  fallback: LocalTrialFallback,
  now: number,
): CommercialState {
  if (billing.kind === "unknown") return "billing_unknown";
  if (billing.kind === "found") return suspended ? "paid_inactive" : "paid_active";
  if (
    Number.isFinite(now)
    && typeof fallback.trialEndsAt === "number"
    && Number.isFinite(fallback.trialEndsAt)
    && now < fallback.trialEndsAt
  ) return "trial_active";
  return "trial_expired";
}
