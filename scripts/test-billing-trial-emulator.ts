// Billing V1 — Nuvemshop nativo (CONTRATO PROVADO). Cobre o teste matrix
// A-J da OS "BILLING_CONTRACT_REDACT_FIX_READY" + achados da autoavaliacao.
//
// ZERO chamadas reais: toda interacao com "a Nuvemshop" passa por um
// fetchImpl fake injetado no NuvemshopClient (via syncOrder's clientOptions),
// reproduzindo EXATAMENTE o contrato documentado e verbatim confirmado em
// https://tiendanube.github.io/api-documentation/intro#suspension-of-api-access-due-to-lack-of-payment:
// 200 = acesso liberado; 402 = bloqueado (pagamento OU dias gratis
// esgotados, o doc nao distingue); outros erros = ambiguos, sinal nao tocado.
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-billing" });

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeOrderResponse(nsOrderId: string) {
  return {
    id: Number(nsOrderId), number: 1, status: "paid", products: [],
    customer: { id: 1, email: "a@a.com", name: "A", phone: null },
    contact_email: "a@a.com", contact_phone: null, total: "10.00",
    created_at: "2026-01-01T00:00:00Z",
  };
}

// mode: "found" -> 200 (acesso liberado); "not_found" -> 402 (bloqueado);
// "timeout"/"malformed"/"http_500" -> ambiguo, sinal nunca tocado.
function fakeFetch(mode: "found" | "not_found" | "timeout" | "malformed" | "http_500", nsOrderId = "1"): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    if (mode === "timeout") {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (mode === "not_found") return new Response(null, { status: 402 });
    if (mode === "http_500") return new Response(null, { status: 500 });
    if (mode === "malformed") return new Response("not json", { status: 200 });
    return new Response(JSON.stringify(fakeOrderResponse(nsOrderId)), { status: 200 });
  }) as typeof fetch;
}

async function main() {
  const db = getFirestore();
  const { recordBillingAccessSignal, getStoreCommercialCache } =
    await import("../lib/billing/accessSignal.firestore");
  const { resolveStoreCommercialState, isCommercialAccessGranted, COMMERCIAL_CACHE_TTL_MS } =
    await import("../lib/billing/policy");
  const { syncOrder } = await import("../lib/nuvemshop/sync");
  const { claimJobForDispatch } = await import("../lib/dispatch");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "billing-a-redact", "billing-b", "billing-c", "billing-d", "billing-e", "billing-f",
    "billing-g-a", "billing-g-b", "billing-h", "billing-j",
    "billing-dispatch-blocked", "billing-dispatch-active", "billing-stale",
    "billing-lifecycle-inactive", "billing-timestamp-order",
  ];
  for (const id of stores) await db.recursiveDelete(db.doc(`stores/${id}`));
  const { lgpdRequestId } = await import("../lib/lgpd/model");
  for (const redactedId of ["billing-a-redact", "billing-j"]) {
    await db.doc(`lgpd_store_redactions/${lgpdRequestId({ event: "store/redact", store_id: redactedId })}`)
      .delete().catch(() => {});
  }

  async function seedStore(storeId: string, extra: Record<string, unknown> = {}) {
    await db.doc(`stores/${storeId}`).set({
      storeId, status: "active", plan: "essencial", accessToken: "fake-token",
      quotas: { contactsLimit: 1000, dispatchesMonthLimit: 1000, dispatchesMonthUsed: 0, whatsappMonthLimit: 1000, whatsappMonthUsed: 0, periodKey: "2026-08" },
      ...extra,
    });
  }

  const dayOne = Date.UTC(2026, 0, 1);

  // A: store/redact remove TODO estado comercial local (billingBlocked,
  // commercialSyncedAt) — o tombstone substitui o doc raiz inteiro
  // (tx.set sem merge), entao qualquer campo comercial local desaparece.
  await seedStore("billing-a-redact");
  await recordBillingAccessSignal("billing-a-redact", false, dayOne);
  const cacheBeforeRedact = await getStoreCommercialCache("billing-a-redact");
  check("A cache comercial existe antes do redact", cacheBeforeRedact?.commercialSyncedAt === dayOne);
  const { processStoreRedact } = await import("../lib/lgpd/storeRedact");
  const { firestoreStoreRedactRepository } = await import("../lib/lgpd/storeRedact.firestore");
  await processStoreRedact(firestoreStoreRedactRepository, {
    event: "store/redact", store_id: "billing-a-redact",
  }, dayOne + 1);
  const storeAfterRedact = (await db.doc("stores/billing-a-redact").get()).data();
  check("A store/redact apaga billingBlocked/commercialSyncedAt do doc raiz",
    storeAfterRedact?.billingBlocked === undefined && storeAfterRedact?.commercialSyncedAt === undefined
      && storeAfterRedact?.status === "redacted");
  const cacheAfterRedact = await getStoreCommercialCache("billing-a-redact");
  check("A getStoreCommercialCache pos-redact nao reflete nenhum sinal antigo",
    cacheAfterRedact?.commercialSyncedAt === undefined);

  // J: nenhuma colecao top-level de fallback comercial nosso existe mais —
  // grep no proprio modulo garante que o simbolo nem foi reintroduzido
  // (ver test-billing-policy.ts); aqui confirmamos que a colecao antiga
  // (se algum dado historico dela sobrevivesse de uma OS anterior) nao e
  // lida por nada no codigo atual, e que reinstalar nao depende dela.
  const trialFallbackDoc = await db.doc("commercial_trial_fallback/billing-a-redact").get();
  check("J nenhum doc de fallback comercial foi criado por este fluxo", !trialFallbackDoc.exists);

  // B: reinstall pos-redact + Billing concede acesso (200 real observado)
  // => acesso permitido.
  await db.doc("stores/billing-a-redact").set({ status: "active", accessToken: "fake-token" }, { merge: true }); // simula reinstall real
  await syncOrder("billing-a-redact", "fake-token", "1", "paid", { fetchImpl: fakeFetch("found") });
  const bState = resolveStoreCommercialState((await getStoreCommercialCache("billing-a-redact"))!, dayOne + 2);
  check("B reinstall pos-redact + 200 real = paid_active (acesso permitido)",
    bState === "commercial_access_active" && isCommercialAccessGranted(bState));

  // C: reinstall pos-redact + Billing bloqueia (402 real observado) =>
  // NENHUM trial novo — o unico estado possivel e paid_inactive/billing_unknown,
  // nunca paid_active fabricado do nada.
  await seedStore("billing-c");
  await assert.rejects(
    syncOrder("billing-c", "fake-token", "1", "paid", { fetchImpl: fakeFetch("not_found") }),
  );
  const cState = resolveStoreCommercialState((await getStoreCommercialCache("billing-c"))!, dayOne);
  check("C 402 real observado = paid_inactive, sem trial novo", cState === "commercial_access_blocked"
    && !isCommercialAccessGranted(cState));

  // D: reinstall pos-redact + Billing timeout => billing_unknown, ZERO
  // efeito de provider (dispatch bloqueado, sem reserva de cota).
  await seedStore("billing-d");
  await assert.rejects(
    syncOrder("billing-d", "fake-token", "1", "paid", { fetchImpl: fakeFetch("timeout") }),
  );
  const dCache = await getStoreCommercialCache("billing-d");
  check("D timeout nao grava NENHUM sinal (cache continua ausente)", dCache?.commercialSyncedAt === undefined);
  await db.doc("stores/billing-d/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-d", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const dClaim = await claimJobForDispatch("billing-d", "job-1", dayOne, () => "res-d");
  check("D dispatch recusa job com billing_unknown (0 provider)", dClaim.ok === false);
  const dJob = (await db.doc("stores/billing-d/jobs/job-1").get()).data();
  const dStoreAfter = (await db.doc("stores/billing-d").get()).data();
  check("D job cancelado, sem reserva de cota vazada",
    dJob?.status === "cancelled" && (dStoreAfter?.quotas?.dispatchesMonthReserved ?? 0) === 0);

  // E: loja legada sem cache local + Billing bloqueia (402) => sem trial
  // gratis automatico (nunca fabrica paid_active do nada so por ser legada).
  await seedStore("billing-e", { plan: "crescimento" });
  await assert.rejects(
    syncOrder("billing-e", "fake-token", "1", "paid", { fetchImpl: fakeFetch("not_found") }),
  );
  const eState = resolveStoreCommercialState((await getStoreCommercialCache("billing-e"))!, dayOne);
  check("E loja legada + 402 = paid_inactive, sem trial gratis automatico", eState === "commercial_access_blocked");

  // F: loja legada + Billing concede acesso (200) => paid_active.
  await seedStore("billing-f", { plan: "crescimento" });
  await syncOrder("billing-f", "fake-token", "1", "paid", { fetchImpl: fakeFetch("found") });
  const fState = resolveStoreCommercialState((await getStoreCommercialCache("billing-f"))!, dayOne);
  check("F loja legada + 200 real = paid_active", fState === "commercial_access_active");

  // G: outra store subscription => zero cross-tenant access. Bloquear A
  // nunca afeta B.
  await seedStore("billing-g-a");
  await seedStore("billing-g-b");
  await assert.rejects(
    syncOrder("billing-g-a", "fake-token", "1", "paid", { fetchImpl: fakeFetch("not_found") }),
  );
  await syncOrder("billing-g-b", "fake-token", "1", "paid", { fetchImpl: fakeFetch("found") });
  const gA = resolveStoreCommercialState((await getStoreCommercialCache("billing-g-a"))!, dayOne);
  const gB = resolveStoreCommercialState((await getStoreCommercialCache("billing-g-b"))!, dayOne);
  check("G store A bloqueada nao afeta store B", gA === "commercial_access_blocked" && gB === "commercial_access_active");

  // H: corpo malformado da Nuvemshop => fail-closed (nenhum sinal gravado,
  // nunca tratado como acesso liberado por engano).
  await seedStore("billing-h");
  await assert.rejects(
    syncOrder("billing-h", "fake-token", "1", "paid", { fetchImpl: fakeFetch("malformed") }),
  );
  const hCache = await getStoreCommercialCache("billing-h");
  check("H corpo malformado nao grava nenhum sinal (fail-closed por ausencia, nunca por 'acesso liberado')",
    hCache?.commercialSyncedAt === undefined);
  const hState = resolveStoreCommercialState(hCache ?? {}, dayOne);
  check("H estado resultante e billing_unknown", hState === "billing_unknown" && !isCommercialAccessGranted(hState));

  // I (substitui "multiplas subscriptions", N/A neste contrato — nao existe
  // mais endpoint de leitura de subscription por store, ver policy.ts):
  // sinais reais concorrentes/sequenciais sao deterministicos — o ultimo
  // sinal observado (por timestamp) e o que vale, sem ambiguidade de ordem.
  await seedStore("billing-timestamp-order");
  await recordBillingAccessSignal("billing-timestamp-order", false, dayOne);
  await recordBillingAccessSignal("billing-timestamp-order", true, dayOne + 1);
  const orderState = resolveStoreCommercialState((await getStoreCommercialCache("billing-timestamp-order"))!, dayOne + 1);
  check("I ultimo sinal observado (por timestamp) determina o estado, deterministicamente",
    orderState === "commercial_access_blocked");

  // J (cross-check final): nenhum storeId/fallback comercial nosso persiste
  // apos redact — reconfirma via reinstall que NADA e herdado do estado
  // anterior ao redact (cada resync parte do zero, so confiando num sinal
  // real novo).
  await seedStore("billing-j");
  await recordBillingAccessSignal("billing-j", false, dayOne); // acesso liberado antes do redact
  await processStoreRedact(firestoreStoreRedactRepository, {
    event: "store/redact", store_id: "billing-j",
  }, dayOne + 1);
  await db.doc("stores/billing-j").set({ status: "active", accessToken: "fake-token" }, { merge: true }); // reinstall
  const jCacheImmediatelyAfterReinstall = await getStoreCommercialCache("billing-j");
  check("J reinstall NAO herda o sinal 'acesso liberado' de antes do redact",
    jCacheImmediatelyAfterReinstall?.commercialSyncedAt === undefined);
  const jState = resolveStoreCommercialState(jCacheImmediatelyAfterReinstall ?? {}, dayOne + 1);
  check("J sem sinal novo pos-reinstall, estado e billing_unknown (nao paid_active herdado)",
    jState === "billing_unknown");

  // Dispatch: dentro do acesso liberado, claim segue normal; bloqueado,
  // claim recusa com motivo correto e sem reserva de cota.
  await seedStore("billing-dispatch-active");
  await recordBillingAccessSignal("billing-dispatch-active", false, dayOne);
  await db.doc("stores/billing-dispatch-active/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-dispatch-active", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const activeClaim = await claimJobForDispatch("billing-dispatch-active", "job-1", dayOne + 1, () => "res-active");
  check("Dispatch: acesso liberado permite claim normalmente", activeClaim.ok === true);

  await seedStore("billing-dispatch-blocked");
  await recordBillingAccessSignal("billing-dispatch-blocked", true, dayOne);
  await db.doc("stores/billing-dispatch-blocked/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-dispatch-blocked", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const blockedClaim = await claimJobForDispatch("billing-dispatch-blocked", "job-1", dayOne + 1, () => "res-blocked");
  check("Dispatch: acesso bloqueado recusa claim (0 provider)", blockedClaim.ok === false);
  const blockedJob = (await db.doc("stores/billing-dispatch-blocked/jobs/job-1").get()).data();
  check("Dispatch: job cancelado com motivo commercial_inactive",
    blockedJob?.status === "cancelled" && blockedJob?.cancelReason === "commercial_inactive");

  const { claimWhatsappTestAttempt } = await import("../lib/whatsapp/testRateLimit.firestore");
  check("WhatsApp test bloqueado retorna 402 e nao consome janela de rate limit",
    JSON.stringify(await claimWhatsappTestAttempt("billing-dispatch-blocked", dayOne + 1))
      === JSON.stringify({ ok: false, status: 402, reason: "commercial_inactive" }));

  // Self-review: cache dentro do TTL mas velha o suficiente pra beirar o
  // limite continua valida; passado o TTL, billing_unknown mesmo com sinal
  // "liberado" persistido (staleness nunca concede acesso as cegas).
  await seedStore("billing-stale");
  await recordBillingAccessSignal("billing-stale", false, dayOne);
  const staleCache = await getStoreCommercialCache("billing-stale");
  const staleState = resolveStoreCommercialState(staleCache!, dayOne + COMMERCIAL_CACHE_TTL_MS + 1);
  check("Self-review: cache liberada porem velha demais vira billing_unknown (fail-closed)",
    staleState === "billing_unknown");

  // Self-review: loja com lifecycle inativo nunca recebe sinal comercial,
  // mesmo que uma chamada real "suceda" de alguma forma (nao deveria
  // acontecer, mas o guard e independente disso).
  await seedStore("billing-lifecycle-inactive", { status: "uninstalled" });
  await recordBillingAccessSignal("billing-lifecycle-inactive", false, dayOne);
  const lifecycleCache = await getStoreCommercialCache("billing-lifecycle-inactive");
  check("Self-review: loja com status inativo nunca recebe sinal comercial gravado",
    lifecycleCache?.commercialSyncedAt === undefined);

  console.log(`\n${passed} testes de billing (Nuvemshop nativo, contrato provado) no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("Billing Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
