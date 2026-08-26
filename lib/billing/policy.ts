// Politica comercial central (Billing V1 — Nuvemshop nativo, CONTRATO PROVADO).
//
// Correcao de uma OS anterior: a implementacao anterior lia
// `GET /concepts/{concept_code}/services/{service_id}/subscriptions` como
// fonte de verdade por store, usando um `?store_id=` inventado (nunca
// documentado). Pesquisa oficial (tiendanube.github.io/api-documentation)
// confirmou que esse endpoint NAO documenta nenhum parametro de selecao por
// store, nem a autenticacao para GET subscriptions/charges (so Plans
// documenta Partner-Action) — logo NAO pode ser usado como fonte de verdade
// por store (ver ADR no relatorio da OS "BILLING_CONTRACT_REDACT_FIX_READY").
//
// Fonte de verdade AGORA (100% documentada, verbatim confirmada em
// https://tiendanube.github.io/api-documentation/intro#suspension-of-api-access-due-to-lack-of-payment):
//   "In either case, all API calls will return a 402 Payment Required
//   response [...] these webhooks [app/suspended, app/resumed] aren't
//   triggered when the app runs out of 'free days'. In these cases the API
//   will also be inaccessible, but no webhooks will be triggered."
//
// Ou seja: a UNICA prova documentada de estado comercial e (a) os webhooks
// app/suspended / app/resumed (documentados, disparam so p/ falta de
// pagamento) e (b) o proprio HTTP 402 observado em QUALQUER chamada real que
// ja fazemos a API da Nuvemshop com o token da loja (order sync, cron de
// carrinhos, registro de webhook no install) — cobre TAMBEM o esgotamento
// dos "dias gratis", que o doc confirma tambem 402 sem webhook.
//
// Nao existe, documentado, um jeito de distinguir "dentro do trial" de
// "pagando" — a Nuvemshop enforce os dois cenarios da MESMA forma (402 se
// bloqueado, acesso liberado caso contrario) e os "dias gratis" sao
// PORTAL_CONFIGURATION (Partner Portal), invisiveis via API. Por isso os
// nomes paid_active/paid_inactive abaixo significam precisamente "a
// Nuvemshop concede/nega acesso a API para esta loja agora" — nunca uma
// confirmacao de pagamento especificamente (nao temos como afirmar isso).
//
// Fonte de tempo: SEMPRE o `now` passado pelo chamador (server-side).

export type CommercialState = "paid_active" | "paid_inactive" | "billing_unknown";

// Cache operacional (Store.commercialSyncedAt) — nunca autoridade perpetua.
// Refrescada a cada chamada real que ja fazemos a Nuvemshop com o token da
// loja (order sync, cron diario de carrinhos, registro de webhook no
// install) e pelos webhooks app/suspended|resumed. Passado o TTL sem
// nenhuma dessas, o gate trata como billing_unknown (fail-closed) — nunca
// herda o ultimo estado conhecido as cegas.
export const COMMERCIAL_CACHE_TTL_MS = 26 * 60 * 60 * 1000;

export interface StoreCommercialCache {
  // true = ultimo sinal PROVADO (webhook ou 402 observado) foi "bloqueado".
  // false/ausente = ultimo sinal provado foi "acesso concedido".
  billingBlocked?: boolean;
  commercialSyncedAt?: number;
}

// Usado por TODOS os gates (dispatch, ativacao de flow, criacao de
// enrollment/job, teste de WhatsApp). Cache ausente/velha demais NUNCA
// concede acesso as cegas — vira billing_unknown (fail-closed). Nao ha mais
// um fallback de "trial local": nao existe contrato documentado que permita
// distinguir trial de pagamento, entao nao fabricamos esse estado.
export function resolveStoreCommercialState(store: StoreCommercialCache, now: number): CommercialState {
  const synced = store.commercialSyncedAt;
  const stale = typeof synced !== "number" || !Number.isFinite(synced)
    || !Number.isFinite(now) || now - synced > COMMERCIAL_CACHE_TTL_MS;
  if (stale) return "billing_unknown";
  return store.billingBlocked === true ? "paid_inactive" : "paid_active";
}

// billing_unknown bloqueia efeito comercial (provider) mas os chamadores
// continuam livres para permitir leitura/configuracao — essa funcao so
// decide o gate de EFEITO real, nunca o de leitura.
export function isCommercialAccessGranted(state: CommercialState): boolean {
  return state === "paid_active";
}
