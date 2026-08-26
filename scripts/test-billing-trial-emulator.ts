import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-billing" });

const DAY_MS = 24 * 60 * 60 * 1000;
const FAKE_CREDENTIALS = { conceptCode: "concept-test", serviceId: "service-test", partnerToken: "token-test" };

// Fake fetch minimo: nunca chama a Nuvemshop real (mandato da OS). `mode`
// decide 404 (not_found) / 200 (found) / erro de rede (unknown).
function fakeFetch(mode: "found" | "not_found" | "network_error" | "malformed" | "http_500"): typeof fetch {
  return (async () => {
    if (mode === "network_error") throw new Error("network down (fake)");
    if (mode === "not_found") return new Response(null, { status: 404 });
    if (mode === "http_500") return new Response(null, { status: 500 });
    if (mode === "malformed") return new Response("not json", { status: 200 });
    return new Response(JSON.stringify({ plan: { code: "essencial" }, next_execution: null, last_execution: null }), { status: 200 });
  }) as typeof fetch;
}

async function main() {
  const db = getFirestore();
  const { syncCommercialState, setBillingSuspended, getStoreCommercialCache } =
    await import("../lib/billing/sync.firestore");
  const { ensureTrialFallbackStarted, getTrialFallbackLedger } =
    await import("../lib/billing/trialFallback.firestore");
  const { resolveStoreCommercialState, isCommercialAccessGranted, TRIAL_DURATION_MS, COMMERCIAL_CACHE_TTL_MS } =
    await import("../lib/billing/policy");
  const { claimJobForDispatch } = await import("../lib/dispatch");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "billing-a", "billing-dup", "billing-concurrent",
    "billing-uninstall", "billing-expired-reinstall", "billing-repeat",
    "billing-paid", "billing-suspended", "billing-tenant-a", "billing-tenant-b",
    "billing-dispatch-expired", "billing-dispatch-active", "billing-redact",
    "billing-api-gate", "billing-api-gate-active", "billing-invalid-fallback",
    "billing-enrollment-expired", "billing-cache-absent-not-new-trial",
    "billing-stale-cache", "billing-legacy-found", "billing-legacy-no-source",
    "billing-webhook-signal", "billing-timeout", "billing-malformed",
    "billing-lifecycle-inactive", "billing-lost-subscription",
  ];
  for (const id of stores) await db.recursiveDelete(db.doc(`stores/${id}`));
  for (const id of stores) await db.doc(`commercial_trial_fallback/${id}`).delete().catch(() => {});
  const { lgpdRequestId } = await import("../lib/lgpd/model");
  await db.doc(`lgpd_store_redactions/${lgpdRequestId({ event: "store/redact", store_id: "billing-redact" })}`)
    .delete().catch(() => {});

  async function seedStore(storeId: string, extra: Record<string, unknown> = {}) {
    await db.doc(`stores/${storeId}`).set({
      storeId, status: "active", plan: "essencial",
      quotas: { contactsLimit: 1000, dispatchesMonthLimit: 1000, dispatchesMonthUsed: 0, whatsappMonthLimit: 1000, whatsappMonthUsed: 0, periodKey: "2026-08" },
      ...extra,
    });
  }

  const dayOne = Date.UTC(2026, 0, 1);

  // A: primeira instalacao (Nuvemshop confirma not_found) concede exatamente
  // 14 dias via fallback local, e a cache do doc raiz reflete isso.
  await seedStore("billing-a");
  const stateA = await syncCommercialState("billing-a", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  check("A primeiro sync sem assinatura -> trial_active", stateA === "trial_active");
  const fallbackA = await getTrialFallbackLedger("billing-a");
  check("A fallback concede exatamente 14 dias", fallbackA?.trialEndsAt === dayOne + TRIAL_DURATION_MS);
  const cacheA = await getStoreCommercialCache("billing-a");
  check("A cache do doc raiz reflete o fallback e foi marcada sincronizada",
    cacheA?.trialEndsAt === fallbackA?.trialEndsAt && typeof cacheA?.commercialSyncedAt === "number");

  // B: sync duplicado (reinstall) nao cria um NOVO fallback -- reaproveita o
  // mesmo trial mesmo chamando de novo bem mais tarde.
  await seedStore("billing-dup");
  await syncCommercialState("billing-dup", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const dupFirst = await getTrialFallbackLedger("billing-dup");
  await syncCommercialState("billing-dup", dayOne + 5 * DAY_MS, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const dupSecond = await getTrialFallbackLedger("billing-dup");
  check("B sync duplicado preserva o mesmo trial (nao reinicia)",
    dupFirst?.trialStartedAt === dupSecond?.trialStartedAt && dupFirst?.trialEndsAt === dupSecond?.trialEndsAt);

  // C: duas chamadas concorrentes reais (Promise.all) produzem um unico trial.
  await seedStore("billing-concurrent");
  await Promise.all([
    ensureTrialFallbackStarted("billing-concurrent", dayOne),
    ensureTrialFallbackStarted("billing-concurrent", dayOne + 1),
  ]);
  const concLedger = await getTrialFallbackLedger("billing-concurrent");
  check("C concorrencia real produz um unico trialStartedAt", concLedger?.trialStartedAt === dayOne || concLedger?.trialStartedAt === dayOne + 1);

  // D: uninstall no dia 5 + reinstall no dia 10 preserva o termino original
  // (dia 15) -- o sync no reinstall NAO cria um trial novo so por a cache do
  // doc raiz estar ausente apos o tombstone.
  await seedStore("billing-uninstall");
  const dInitial = await syncCommercialState("billing-uninstall", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  check("D primeiro sync concede trial", dInitial === "trial_active");
  const dFallback = await getTrialFallbackLedger("billing-uninstall");
  const { handleAppUninstalled } = await import("../lib/lifecycle/uninstall");
  await handleAppUninstalled("billing-uninstall", dayOne + 5 * DAY_MS);
  await db.doc("stores/billing-uninstall").update({ status: "active" }); // simula reinstall real (callback)
  await syncCommercialState("billing-uninstall", dayOne + 10 * DAY_MS, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const dFallbackAfter = await getTrialFallbackLedger("billing-uninstall");
  check("D reinstall dia 10 preserva termino do dia 15 (fallback nunca reinicia)",
    dFallbackAfter?.trialEndsAt === dFallback?.trialEndsAt && dFallbackAfter?.trialStartedAt === dFallback?.trialStartedAt);

  // E: reinstall depois do dia 14 continua expirado (nao ganha dias novos).
  await seedStore("billing-expired-reinstall");
  await syncCommercialState("billing-expired-reinstall", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const eStateDay30 = await syncCommercialState("billing-expired-reinstall", dayOne + 30 * DAY_MS, fakeFetch("not_found"), FAKE_CREDENTIALS);
  check("E reinstall no dia 30 continua trial_expired (sem assinatura real)", eStateDay30 === "trial_expired");

  // F: uninstall/reinstall repetido 20x nunca reseta o trial (reduzido de 100x
  // do teste anterior so por custo de I/O do Emulator; a logica testada e a
  // mesma transacao idempotente de C/D).
  await seedStore("billing-repeat");
  await syncCommercialState("billing-repeat", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const fInitial = await getTrialFallbackLedger("billing-repeat");
  for (let i = 0; i < 20; i++) {
    await handleAppUninstalled("billing-repeat", dayOne + i * 1000);
    await db.doc("stores/billing-repeat").update({ status: "active" });
    await syncCommercialState("billing-repeat", dayOne + i * 1000 + 500, fakeFetch("not_found"), FAKE_CREDENTIALS);
  }
  const fFinal = await getTrialFallbackLedger("billing-repeat");
  check("F 20 ciclos de uninstall/reinstall preservam o trial original",
    fFinal?.trialStartedAt === fInitial?.trialStartedAt && fFinal?.trialEndsAt === fInitial?.trialEndsAt);

  // G: cache AUSENTE (nunca sincronizada) NAO e tratada como "loja nova" --
  // resolveStoreCommercialState so cai para trial_active se o fallback local
  // realmente ainda nao venceu; sem fallback nenhum, vira billing_unknown
  // (fail-closed), nunca um trial novo inventado por ausencia de cache.
  await seedStore("billing-cache-absent-not-new-trial");
  const gState = resolveStoreCommercialState({}, dayOne);
  check("G cache ausente sem fallback local = billing_unknown, nunca trial novo", gState === "billing_unknown");

  // H: assinatura ativa (Billing confirma found) concede acesso mesmo com
  // trial local ja vencido.
  await seedStore("billing-paid");
  await ensureTrialFallbackStarted("billing-paid", dayOne); // trial ja consumido/vencido antes de assinar
  const paidState = await syncCommercialState("billing-paid", dayOne + 30 * DAY_MS, fakeFetch("found"), FAKE_CREDENTIALS);
  check("H assinatura encontrada na Nuvemshop concede acesso mesmo com trial vencido",
    paidState === "paid_active" && isCommercialAccessGranted(paidState));

  // I: app/suspended (sem app/resumed desde entao) + assinatura encontrada =
  // paid_inactive -- bloqueia mesmo com assinatura "existindo".
  await seedStore("billing-suspended");
  await syncCommercialState("billing-suspended", dayOne, fakeFetch("found"), FAKE_CREDENTIALS);
  await setBillingSuspended("billing-suspended", true);
  const suspendedState = await syncCommercialState("billing-suspended", dayOne + 1, fakeFetch("found"), FAKE_CREDENTIALS);
  check("I app/suspended com assinatura encontrada = paid_inactive",
    suspendedState === "paid_inactive" && !isCommercialAccessGranted(suspendedState));
  await setBillingSuspended("billing-suspended", false);
  const resumedState = await syncCommercialState("billing-suspended", dayOne + 2, fakeFetch("found"), FAKE_CREDENTIALS);
  check("I app/resumed depois reverte para paid_active", resumedState === "paid_active");

  // J: store A nao afeta store B.
  await seedStore("billing-tenant-a");
  await seedStore("billing-tenant-b");
  await syncCommercialState("billing-tenant-a", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  await syncCommercialState("billing-tenant-b", dayOne + 3 * DAY_MS, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const tA = await getTrialFallbackLedger("billing-tenant-a");
  const tB = await getTrialFallbackLedger("billing-tenant-b");
  check("J trials de stores diferentes sao independentes", tA?.trialStartedAt !== tB?.trialStartedAt);

  // K: fallback invalido falha fechado, sem conceder novo trial.
  await seedStore("billing-invalid-fallback");
  await db.doc("commercial_trial_fallback/billing-invalid-fallback").set({
    trialConsumed: true, trialStartedAt: dayOne, trialEndsAt: Number.POSITIVE_INFINITY,
  });
  await assert.rejects(
    ensureTrialFallbackStarted("billing-invalid-fallback", dayOne + DAY_MS),
    /invalid_trial_fallback_ledger/,
  );
  check("K fallback invalido falha fechado sem conceder novo trial", true);

  // L (critico): store/redact real apaga o doc raiz (tombstone), mas o
  // fallback top-level sobrevive por construcao (purga so enumera subcolecoes
  // de stores/{storeId}). Reinstall pos-redact NAO deve ganhar um trial novo,
  // mesmo com a cache do doc raiz apagada e resincronizada do zero.
  const { processStoreRedact } = await import("../lib/lgpd/storeRedact");
  const { firestoreStoreRedactRepository } = await import("../lib/lgpd/storeRedact.firestore");
  await seedStore("billing-redact");
  const beforeRedact = (await syncCommercialState("billing-redact", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS), await getTrialFallbackLedger("billing-redact"))!;
  await processStoreRedact(firestoreStoreRedactRepository, {
    event: "store/redact", store_id: "billing-redact",
  }, dayOne + 5 * DAY_MS);
  const storeAfterRedact = (await db.doc("stores/billing-redact").get()).data();
  check("L store/redact apaga plan/quotas/cache comercial do doc raiz",
    storeAfterRedact?.status === "redacted" && storeAfterRedact?.trialEndsAt === undefined
      && storeAfterRedact?.plan === undefined);
  const fallbackAfterRedact = await getTrialFallbackLedger("billing-redact");
  check("L o fallback sobrevive intacto ao store/redact (imune por construcao)",
    fallbackAfterRedact?.trialStartedAt === beforeRedact.trialStartedAt
      && fallbackAfterRedact?.trialEndsAt === beforeRedact.trialEndsAt);
  await db.doc("stores/billing-redact").set({ status: "active" }, { merge: true }); // simula reinstall real
  await syncCommercialState("billing-redact", dayOne + 10 * DAY_MS, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const fallbackAfterRedactReinstall = await getTrialFallbackLedger("billing-redact");
  check("L reinstall pos-redact NAO ganha trial novo (mesmo termino de sempre)",
    fallbackAfterRedactReinstall?.trialStartedAt === beforeRedact.trialStartedAt
      && fallbackAfterRedactReinstall?.trialEndsAt === beforeRedact.trialEndsAt);

  // M: legado com assinatura real encontrada na Nuvemshop -> paid_active,
  // sem depender de nenhum ledger local.
  await seedStore("billing-legacy-found", { plan: "crescimento" });
  const legacyFoundState = await syncCommercialState("billing-legacy-found", dayOne, fakeFetch("found"), FAKE_CREDENTIALS);
  check("M loja legada com assinatura real na Nuvemshop = paid_active", legacyFoundState === "paid_active");

  // N: legado SEM fonte confiavel (Nuvemshop responde not_found -- nunca
  // teve assinatura para o service atual) recebe o MESMO tratamento de uma
  // loja nova: fallback de cortesia, nunca acesso permanente inventado.
  await seedStore("billing-legacy-no-source", { plan: "crescimento" });
  const legacyNoSourceState = await syncCommercialState("billing-legacy-no-source", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  check("N loja legada sem fonte confiavel recebe fallback de trial, nao acesso permanente",
    legacyNoSourceState === "trial_active");
  const legacyLedger = await getTrialFallbackLedger("billing-legacy-no-source");
  check("N o fallback da loja legada tem prazo (nao e perpetuo)",
    legacyLedger?.trialEndsAt === dayOne + TRIAL_DURATION_MS);

  // O: dispatch (o caminho real de envio) bloqueia quando o trial expirou --
  // nao depende da UI. Testa via claimJobForDispatch real contra o Emulator.
  await seedStore("billing-dispatch-expired");
  await syncCommercialState("billing-dispatch-expired", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  await db.doc("stores/billing-dispatch-expired/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-dispatch-expired", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const expiredClaim = await claimJobForDispatch("billing-dispatch-expired", "job-1", dayOne + 30 * DAY_MS, () => "res-1");
  check("O dispatch recusa job com trial expirado (0 provider)", expiredClaim.ok === false);
  const expiredJob = (await db.doc("stores/billing-dispatch-expired/jobs/job-1").get()).data();
  check("O job cancelado com motivo trial_expired, sem reserva de cota",
    expiredJob?.status === "cancelled" && expiredJob?.cancelReason === "trial_expired");
  const expiredStoreAfter = (await db.doc("stores/billing-dispatch-expired").get()).data();
  check("O nenhuma reserva de cota vazou para uma tentativa bloqueada",
    (expiredStoreAfter?.quotas?.dispatchesMonthReserved ?? 0) === 0);

  const { claimWhatsappTestAttempt } = await import("../lib/whatsapp/testRateLimit.firestore");
  check("O teste WhatsApp com trial expirado retorna 402 e nao chama provider",
    JSON.stringify(await claimWhatsappTestAttempt("billing-dispatch-expired", dayOne + 30 * DAY_MS))
      === JSON.stringify({ ok: false, status: 402, reason: "commercial_inactive" }));
  check("O teste bloqueado nao consome janela de rate limit",
    !(await db.doc("stores/billing-dispatch-expired/whatsapp_test_limits/global").get()).exists);

  // P: dentro do trial, o claim segue normalmente (nao bloqueia).
  await seedStore("billing-dispatch-active");
  await syncCommercialState("billing-dispatch-active", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  await db.doc("stores/billing-dispatch-active/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-dispatch-active", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const activeClaim = await claimJobForDispatch("billing-dispatch-active", "job-1", dayOne + 1 * DAY_MS, () => "res-2");
  check("P dentro do trial o claim e aceito normalmente", activeClaim.ok === true);

  // Q: enrollment/job e bloqueado na transacao, antes de reservar cota ou
  // chegar ao dispatch final.
  await seedStore("billing-enrollment-expired");
  await syncCommercialState("billing-enrollment-expired", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  await db.doc("stores/billing-enrollment-expired/flows/cart-flow").set({
    flowId: "cart-flow", name: "fixture", status: "active",
    trigger: { event: "cart_abandoned", match: "all", conditions: [] },
    steps: [{ delay: { value: 1, unit: "days" }, action: "email" }],
    stats: { enrolled: 0, sent: 0, failed: 0 }, createdAt: dayOne,
  });
  const { enrollCartInFlows } = await import("../lib/rules/process");
  const enrollmentsCreated = await enrollCartInFlows(
    "billing-enrollment-expired",
    { cartId: "cart-1", nsCheckoutId: "checkout-1", contactId: "contact-1", total: 1, items: [], recoveryUrl: null, createdAt: dayOne + 30 * DAY_MS, abandonedAt: dayOne + 30 * DAY_MS, status: "abandoned" },
    { contactId: "contact-1", nsCustomerId: null, name: null, email: null, phone: null, tags: [], ordersCount: 0, totalSpent: 0, optOut: false, lastOrderAt: null },
  );
  check("Q trial expirado cria zero enrollment/job", enrollmentsCreated === 0
    && (await db.collection("stores/billing-enrollment-expired/enrollments").get()).empty
    && (await db.collection("stores/billing-enrollment-expired/jobs").get()).empty);

  // R: job ja processing cruza a virada do trial; a guarda final observa o
  // estado expirado e nao invoca o provider.
  const { runWithFinalCommercialGuard } = await import("../lib/dispatch/finalGuard");
  let providerCalls = 0;
  const processingAtExpiry = await runWithFinalCommercialGuard(
    async () => ({
      storeActive: true,
      commercialAccess: isCommercialAccessGranted(
        resolveStoreCommercialState({ trialEndsAt: dayOne + TRIAL_DURATION_MS, commercialSyncedAt: dayOne }, dayOne + TRIAL_DURATION_MS),
      ),
      jobProcessing: true,
      enrollmentActive: true,
    }),
    async () => { providerCalls++; },
  );
  check("R processing na virada bloqueia provider", processingAtExpiry.status === "blocked" && providerCalls === 0);

  // S: a API tambem bloqueia (nao so o dispatch/worker) -- ativar um fluxo com
  // trial vencido falha com 402 real, sem depender de nenhuma checagem de UI.
  const { NextRequest } = await import("next/server");
  const { POST: flowsPost } = await import("../app/api/flows/route");
  await seedStore("billing-api-gate");
  await syncCommercialState("billing-api-gate", dayOne, fakeFetch("not_found"), FAKE_CREDENTIALS);
  const activateExpired = await flowsPost(new NextRequest("https://app.test/api/flows", {
    method: "POST",
    headers: { "x-store-id": "billing-api-gate", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Fluxo teste", status: "active",
      trigger: { event: "order_paid", match: "all", conditions: [] }, steps: [],
    }),
  }));
  check("S ativar fluxo com trial vencido responde 402 (API bloqueia, nao so UI)",
    activateExpired.status === 402);
  const flowsAfterExpired = await db.collection("stores/billing-api-gate/flows").get();
  check("S nenhum fluxo ativo foi criado quando bloqueado", flowsAfterExpired.empty);

  // Controle positivo: dentro do trial, ativar funciona normalmente. A rota
  // usa Date.now() real (nao aceita `now` injetado) para resolver a cache, e
  // resolveStoreCommercialState so aceita cache dentro do TTL -- por isso o
  // sync tambem precisa rodar com Date.now() real, nao o fixture historico.
  await seedStore("billing-api-gate-active");
  await syncCommercialState("billing-api-gate-active", Date.now(), fakeFetch("not_found"), FAKE_CREDENTIALS);
  const activateOk = await flowsPost(new NextRequest("https://app.test/api/flows", {
    method: "POST",
    headers: { "x-store-id": "billing-api-gate-active", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Fluxo teste", status: "active",
      trigger: { event: "order_paid", match: "all", conditions: [] }, steps: [],
    }),
  }));
  check("Controle positivo: dentro do trial, ativar fluxo funciona normalmente", activateOk.status === 200);

  // T: cache velha demais (passou do TTL) sem fallback local valido vira
  // billing_unknown -- o gate de EFEITO comercial bloqueia, mas a leitura
  // (dispatch dentro da API de status) segue livre (nao e testada aqui pois
  // /api/billing/status so LE, nunca decide efeito comercial).
  await seedStore("billing-stale-cache");
  await syncCommercialState("billing-stale-cache", dayOne, fakeFetch("found"), FAKE_CREDENTIALS);
  const staleCache = await getStoreCommercialCache("billing-stale-cache");
  const staleState = resolveStoreCommercialState(staleCache!, dayOne + COMMERCIAL_CACHE_TTL_MS + 1);
  check("T cache paid_active velha demais sem resync vira billing_unknown (fail-closed)",
    staleState === "billing_unknown");

  // U: falha da Nuvemshop (timeout/erro de rede) nunca sobrescreve uma cache
  // boa existente -- preserva o ultimo estado conhecido ate o TTL expirar.
  await seedStore("billing-timeout");
  await syncCommercialState("billing-timeout", dayOne, fakeFetch("found"), FAKE_CREDENTIALS);
  const cacheBeforeTimeout = await getStoreCommercialCache("billing-timeout");
  const timeoutState = await syncCommercialState("billing-timeout", dayOne + 1000, fakeFetch("network_error"), FAKE_CREDENTIALS);
  check("U falha de rede no sync retorna billing_unknown", timeoutState === "billing_unknown");
  const cacheAfterTimeout = await getStoreCommercialCache("billing-timeout");
  check("U falha de rede NAO sobrescreve a cache boa existente (preserva ultimo estado)",
    cacheAfterTimeout?.subscriptionStatus === cacheBeforeTimeout?.subscriptionStatus
      && cacheAfterTimeout?.commercialSyncedAt === cacheBeforeTimeout?.commercialSyncedAt);

  // V: corpo malformado / HTTP inesperado da Nuvemshop tambem fecham (unknown),
  // nunca sao tratados como found/not_found por engano.
  await seedStore("billing-malformed");
  const malformedState = await syncCommercialState("billing-malformed", dayOne, fakeFetch("malformed"), FAKE_CREDENTIALS);
  check("V corpo malformado da Nuvemshop = billing_unknown (fail-closed)", malformedState === "billing_unknown");
  const cacheMalformed = await getStoreCommercialCache("billing-malformed");
  check("V nenhuma cache foi gravada para uma loja que nunca sincronizou com sucesso",
    cacheMalformed?.commercialSyncedAt === undefined);

  // W: loja com lifecycle inativo (uninstalled/redacting/redacted) nunca gera
  // chamada real ao Billing, independente do que a assinatura diga -- o
  // status do ciclo de vida sempre precede o estado de assinatura.
  await seedStore("billing-lifecycle-inactive", { status: "uninstalled" });
  let providerCallsLifecycle = 0;
  const lifecycleFetch: typeof fetch = (async () => { providerCallsLifecycle++; return new Response(null, { status: 404 }); }) as typeof fetch;
  const lifecycleState = await syncCommercialState("billing-lifecycle-inactive", dayOne, lifecycleFetch, FAKE_CREDENTIALS);
  check("W loja com status inativo nunca chama o Billing (0 chamadas)", providerCallsLifecycle === 0);
  check("W loja com status inativo resolve billing_unknown sem tocar a Nuvemshop", lifecycleState === "billing_unknown");

  // X (critico, achado na autoavaliacao adversarial): uma loja que JA teve
  // assinatura real encontrada (found) e depois perde essa assinatura
  // (not_found na proxima consulta) NAO pode ganhar um trial novo so porque
  // ela nunca usou o fallback local antes. Sem essa guarda, toda transicao
  // found -> not_found concederia 14 dias de cortesia de graca.
  await seedStore("billing-lost-subscription");
  const lostSubBefore = await syncCommercialState("billing-lost-subscription", dayOne, fakeFetch("found"), FAKE_CREDENTIALS);
  check("X assinatura encontrada inicialmente = paid_active", lostSubBefore === "paid_active");
  const lostSubAfter = await syncCommercialState("billing-lost-subscription", dayOne + 1, fakeFetch("not_found"), FAKE_CREDENTIALS);
  check("X assinatura que sumiu (found -> not_found) NAO concede trial novo",
    lostSubAfter === "trial_expired" && !isCommercialAccessGranted(lostSubAfter));
  const lostSubFallback = await getTrialFallbackLedger("billing-lost-subscription");
  check("X nenhum fallback foi criado para a loja que perdeu a assinatura", lostSubFallback === null);

  console.log(`\n${passed} testes de billing/trial (Nuvemshop nativo) no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("Billing trial Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
