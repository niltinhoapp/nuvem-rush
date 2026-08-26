// Politica comercial central (Billing V1 — Nuvemshop nativo, CONTRATO PROVADO).
//
// Correcao de duas OS anteriores:
//
// 1) A implementacao original lia
//    `GET /concepts/{concept_code}/services/{service_id}/subscriptions` como
//    fonte de verdade por store, usando um `?store_id=` inventado (nunca
//    documentado). Pesquisa oficial (tiendanube.github.io/api-documentation)
//    confirmou que esse endpoint NAO documenta selecao por store nem a
//    autenticacao para GET subscriptions/charges (so Plans documenta
//    Partner-Action) — removido como fonte de verdade.
//
// 2) A correcao (1) ainda chamava um HTTP 200 de "paid_active" — nomeando
//    como se fosse prova de PAGAMENTO. Nao e: 200 so prova que a Nuvemshop
//    concede acesso a API AGORA (que cobre tanto "dentro do trial gratis"
//    quanto "pagando" — nao ha, documentado, como distinguir os dois). Os
//    estados abaixo foram renomeados para refletir exatamente isso, e nunca
//    mais que isso.
//
// Fonte de verdade (100% documentada, verbatim confirmada em
// https://tiendanube.github.io/api-documentation/intro#suspension-of-api-access-due-to-lack-of-payment):
//   "In either case, all API calls will return a 402 Payment Required
//   response [...] these webhooks [app/suspended, app/resumed] aren't
//   triggered when the app runs out of 'free days'. In these cases the API
//   will also be inaccessible, but no webhooks will be triggered."
//
// Ou seja: a UNICA prova documentada de estado comercial e (a) os webhooks
// app/suspended / app/resumed (documentados, disparam so p/ falta de
// pagamento) e (b) o proprio HTTP 402 observado em QUALQUER chamada real que
// ja fazemos a API da Nuvemshop com o token da loja — cobre TAMBEM o
// esgotamento dos "dias gratis", que o doc confirma tambem 402 sem webhook,
// e por isso NUNCA depende so de webhook para detectar fim do trial.
//
// Fonte de tempo: SEMPRE o `now` passado pelo chamador (server-side).

export type CommercialState = "commercial_access_active" | "commercial_access_blocked" | "billing_unknown";

// Cache operacional (Store.commercialSyncedAt) — nunca autoridade perpetua, e
// MUITO mais curta que os 14 dias de trial do Partner Portal (nao ha risco
// de atravessar o vencimento do trial: mesmo o pior caso, 26h, e ~4% de 14
// dias). Refrescada a cada chamada real que ja fazemos a Nuvemshop com o
// token da loja e pelos webhooks app/suspended|resumed. Passado o TTL sem
// nenhuma dessas, o gate trata como billing_unknown (fail-closed) — nunca
// herda o ultimo estado conhecido as cegas.
//
// Esta cache serve so como PRE-FILTRO barato (claim de job, ativacao de
// flow) — NUNCA autoriza sozinha um efeito comercial externo real, seja qual
// for a idade do sinal positivo (mesmo "ha 1 segundo"). Correcao desta OS:
// um positivo em cache (mesmo recente) nao e prova suficiente para gastar um
// provider real — so um probe feito NA MESMA execucao (ou uma resposta 2xx
// genuina obtida na mesma execucao, com vinculo explicito de store/execucao)
// autoriza. Um NEGATIVO em cache, por outro lado, pode continuar sendo usado
// como atalho seguro (bloquear a mais e fail-closed, nunca um risco). Ver
// ensureFreshCommercialAccess em accessSignal.firestore.ts.
export const COMMERCIAL_CACHE_TTL_MS = 26 * 60 * 60 * 1000;

// Janela para reaproveitar um sinal 2xx/402 OBTIDO NA MESMA EXECUCAO
// comercial (ex.: um probe que acabou de rodar dentro do mesmo dispatchJob),
// nunca uma cache persistida entre execucoes diferentes. Bem curta de
// proposito — so cobre "a resposta que acabei de receber, sem nenhum await
// assincrono relevante depois" (ex.: milissegundos entre o probe e o
// re-check final), nunca "5 minutos atras" ou "outro job/cron".
export const SAME_EXECUTION_SIGNAL_REUSE_MS = 2_000;

export interface StoreCommercialCache {
  // true = ultimo sinal PROVADO (webhook ou 402 observado) foi "bloqueado".
  // false/ausente = ultimo sinal provado foi "acesso concedido".
  billingBlocked?: boolean;
  commercialSyncedAt?: number;
}

// Usado como PRE-FILTRO pelos gates (claim de job, criacao de enrollment/job,
// ativacao de flow). Cache ausente/velha demais NUNCA concede acesso as
// cegas — vira billing_unknown (fail-closed). Nao ha fallback de "trial
// local": nao existe contrato documentado que permita distinguir trial de
// pagamento, entao nao fabricamos esse estado — so refletimos o que foi
// PROVADO (a Nuvemshop concede ou nega acesso agora).
export function resolveStoreCommercialState(store: StoreCommercialCache, now: number): CommercialState {
  const synced = store.commercialSyncedAt;
  const stale = typeof synced !== "number" || !Number.isFinite(synced)
    || !Number.isFinite(now) || now - synced > COMMERCIAL_CACHE_TTL_MS;
  if (stale) return "billing_unknown";
  return store.billingBlocked === true ? "commercial_access_blocked" : "commercial_access_active";
}

// billing_unknown bloqueia efeito comercial (provider) mas os chamadores
// continuam livres para permitir leitura/configuracao — essa funcao so
// decide o gate de EFEITO real, nunca o de leitura.
export function isCommercialAccessGranted(state: CommercialState): boolean {
  return state === "commercial_access_active";
}
