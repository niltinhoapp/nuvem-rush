// Billing V1 — guarda final SEM confianca em cache positivo (OS
// "BILLING_EXACT_TRIAL_BOUNDARY_READY"). Fecha a janela de ate 5 min da OS
// anterior: nenhum sinal positivo em cache, seja qual for a idade, autoriza
// um provider comercial sozinho. So (a) um probe feito AGORA, ou (b) um
// sinal 2xx/402 desta MESMA execucao (escopado a esta store exata, dentro
// de SAME_EXECUTION_SIGNAL_REUSE_MS), autorizam. Negativo em cache pode
// continuar sendo usado como atalho (fail-closed nunca e risco).
//
// ZERO chamadas reais: fetchImpl fake injetado em dispatchJob/claimWhatsappTestAttempt.
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-billing" });

type ProbeCall = { url: string; auth: string | null };

// mode: "active" -> 200 (GET /store real); "blocked" -> 402;
// "timeout"/"malformed"/"http_500" -> ambiguo. `onCall` roda ANTES da
// resposta ser devolvida — simula algo acontecendo enquanto esperamos a
// rede (corrida: uninstall/cancelamento/perda de reserva durante o probe).
function fakeFetch(
  mode: "active" | "blocked" | "timeout" | "malformed" | "http_500",
  calls: ProbeCall[],
  onCall?: () => Promise<void>,
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, auth: headers?.Authentication ?? null });
    if (onCall) await onCall();
    if (mode === "timeout") {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (mode === "blocked") return new Response(null, { status: 402 });
    if (mode === "http_500") return new Response(null, { status: 500 });
    if (mode === "malformed") return new Response("not json", { status: 200 });
    return new Response(JSON.stringify({ domains: ["loja.com.br"], original_domain: "loja.nuvemshop.com.br" }), { status: 200 });
  }) as typeof fetch;
}

async function main() {
  const db = getFirestore();
  const { recordBillingAccessSignal, getStoreCommercialCache, ensureFreshCommercialAccess } =
    await import("../lib/billing/accessSignal.firestore");
  const { SAME_EXECUTION_SIGNAL_REUSE_MS } = await import("../lib/billing/policy");
  const { dispatchJob } = await import("../lib/dispatch");
  const { claimWhatsappTestAttempt } = await import("../lib/whatsapp/testRateLimit.firestore");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "probe-a", "probe-b", "probe-c", "probe-d", "probe-e", "probe-f", "probe-g",
    "probe-h", "probe-i", "probe-j", "probe-k-a", "probe-k-b", "probe-wa", "probe-m", "probe-m-expired",
  ];
  for (const id of stores) await db.recursiveDelete(db.doc(`stores/${id}`));

  async function seedStore(storeId: string, extra: Record<string, unknown> = {}) {
    await db.doc(`stores/${storeId}`).set({
      storeId, status: "active", plan: "essencial", accessToken: "fake-token",
      quotas: { contactsLimit: 1000, dispatchesMonthLimit: 1000, dispatchesMonthUsed: 0, whatsappMonthLimit: 1000, whatsappMonthUsed: 0, periodKey: "2026-08" },
      ...extra,
    });
  }

  async function seedScheduledJob(storeId: string) {
    await db.doc(`stores/${storeId}/jobs/job-1`).set({
      jobId: "job-1", storeId, enrollmentId: "enr-1", flowId: "flow-1",
      stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
    });
    await db.doc(`stores/${storeId}/enrollments/enr-1`).set({
      enrollmentId: "enr-1", flowId: "flow-1", status: "active", currentStep: 0, startedAt: 1,
    });
    await db.doc(`stores/${storeId}/flows/flow-1`).set({
      flowId: "flow-1", name: "fixture", status: "active",
      trigger: { event: "order_paid", match: "all", conditions: [] },
      steps: [{ delay: { value: 0, unit: "days" }, action: "email" }],
      stats: { enrolled: 0, sent: 0, failed: 0 }, createdAt: 1,
    });
  }

  // dispatchJob chama claimJobForDispatch INTERNAMENTE sem receber `now`
  // injetado (ele usa Date.now() real, por design de producao). Por isso
  // este teste ancora em Date.now() real, nao numa data simulada fixa —
  // caso contrario, o pre-filtro do claim (TTL de 26h) fica sujeito a
  // "envelhecer" conforme o relogio real avanca entre execucoes deste
  // arquivo, quebrando cenarios que dependem de um sinal "antigo mas ainda
  // dentro do TTL de 26h" (ver ensureFreshCommercialAccess/claimJobForDispatch).
  const now = Date.now();

  // A: 200 de 1s atras em cache + probe atual 402 => provider 0.
  await seedStore("probe-a");
  await seedScheduledJob("probe-a");
  await recordBillingAccessSignal("probe-a", false, now - 1000); // "liberado" ha 1s
  const aCalls: ProbeCall[] = [];
  const aResult = await dispatchJob("probe-a", "job-1", fakeFetch("blocked", aCalls));
  check("A cache positiva de 1s atras NAO basta: probe atual 402 => cancelado (0 provider)",
    aResult.status === "cancelled" && aCalls.length === 1);

  // B: 200 de 4m59s atras + probe atual 402 => provider 0 (mesma regra de A,
  // prova que NAO existe mais janela de frescor para positivo).
  await seedStore("probe-b");
  await seedScheduledJob("probe-b");
  await recordBillingAccessSignal("probe-b", false, now - (5 * 60 * 1000 - 1000));
  const bCalls: ProbeCall[] = [];
  const bResult = await dispatchJob("probe-b", "job-1", fakeFetch("blocked", bCalls));
  check("B cache positiva de 4m59s atras tambem NAO basta: probe atual 402 => cancelado (0 provider)",
    bResult.status === "cancelled" && bCalls.length === 1);

  // C: cache positiva recem-gravada (poucos ms) SEM sameExecutionSignal ->
  // ensureFreshCommercialAccess ainda assim faz o probe (nao basta sozinha).
  await seedStore("probe-c");
  await recordBillingAccessSignal("probe-c", false, now);
  const cCalls: ProbeCall[] = [];
  const cState = await ensureFreshCommercialAccess("probe-c", "fake-token", now + 1, fakeFetch("blocked", cCalls));
  check("C cache positiva recem-gravada nao dispensa o probe (probe foi feito)", cCalls.length === 1);
  check("C resultado reflete o probe atual (402), nao a cache antiga (liberado)",
    cState === "commercial_access_blocked");

  // D: probe atual 200 => provider permitido se demais guards passam.
  await seedStore("probe-d");
  await seedScheduledJob("probe-d");
  const dCalls: ProbeCall[] = [];
  const dResult = await dispatchJob("probe-d", "job-1", fakeFetch("active", dCalls));
  check("D probe 200 => gate comercial libera (nao cancela por commercial_inactive)",
    !(dResult.status === "cancelled" && "reason" in dResult && /comercial/i.test(String((dResult as { reason?: string }).reason ?? ""))));
  const dCache = await getStoreCommercialCache("probe-d");
  check("D sinal gravado como liberado apos o probe", dCache?.billingBlocked === false);

  // E: probe atual timeout => provider 0. Sinal antigo (mas dentro do TTL de
  // 26h do pre-filtro do claim) garante que o job chega ate a guarda final,
  // onde o probe (sempre feito, ver regra critica) encontra o timeout.
  await seedStore("probe-e");
  await seedScheduledJob("probe-e");
  await recordBillingAccessSignal("probe-e", false, now - 10 * 60 * 1000);
  const eCalls: ProbeCall[] = [];
  const eResult = await dispatchJob("probe-e", "job-1", fakeFetch("timeout", eCalls));
  check("E probe timeout => cancelado (0 provider)", eResult.status === "cancelled" && eCalls.length >= 1);

  // F: probe atual 5xx => provider 0.
  await seedStore("probe-f");
  await seedScheduledJob("probe-f");
  await recordBillingAccessSignal("probe-f", false, now - 10 * 60 * 1000);
  const fCalls: ProbeCall[] = [];
  const fResult = await dispatchJob("probe-f", "job-1", fakeFetch("http_500", fCalls));
  check("F probe 5xx => cancelado (0 provider)", fResult.status === "cancelled" && fCalls.length >= 1);

  // G: probe atual 402 => provider 0.
  await seedStore("probe-g");
  await seedScheduledJob("probe-g");
  await recordBillingAccessSignal("probe-g", false, now - 10 * 60 * 1000);
  const gCalls: ProbeCall[] = [];
  const gResult = await dispatchJob("probe-g", "job-1", fakeFetch("blocked", gCalls));
  check("G probe 402 => cancelado (0 provider)", gResult.status === "cancelled" && gCalls.length >= 1);

  // H: store desinstalada DURANTE o probe (a mutacao acontece dentro do
  // fetch fake, simulando a corrida) => provider 0, mesmo com o probe em si
  // retornando 200. A RE-LEITURA pos-probe pega o uninstall.
  await seedStore("probe-h");
  await seedScheduledJob("probe-h");
  await recordBillingAccessSignal("probe-h", false, now - 10 * 60 * 1000);
  const hCalls: ProbeCall[] = [];
  const hResult = await dispatchJob("probe-h", "job-1", fakeFetch("active", hCalls, async () => {
    await db.doc("stores/probe-h").set({ status: "uninstalled" }, { merge: true });
  }));
  check("H store desinstalada durante o probe => cancelado (0 provider), mesmo com probe 200",
    hResult.status === "cancelled");

  // I: enrollment cancelado DURANTE o probe => provider 0.
  await seedStore("probe-i");
  await seedScheduledJob("probe-i");
  await recordBillingAccessSignal("probe-i", false, now - 10 * 60 * 1000);
  const iCalls: ProbeCall[] = [];
  const iResult = await dispatchJob("probe-i", "job-1", fakeFetch("active", iCalls, async () => {
    await db.doc("stores/probe-i/enrollments/enr-1").set({ status: "cancelled" }, { merge: true });
  }));
  check("I enrollment cancelado durante o probe => cancelado (0 provider), mesmo com probe 200",
    iResult.status === "cancelled");

  // J: reserva de cota perdida DURANTE o probe (outro worker "roubou" o job)
  // => provider 0.
  await seedStore("probe-j");
  await seedScheduledJob("probe-j");
  await recordBillingAccessSignal("probe-j", false, now - 10 * 60 * 1000);
  const jCalls: ProbeCall[] = [];
  const jResult = await dispatchJob("probe-j", "job-1", fakeFetch("active", jCalls, async () => {
    await db.doc("stores/probe-j/jobs/job-1").set({ quotaReservationId: "outro-worker" }, { merge: true });
  }));
  check("J reserva de cota perdida durante o probe => cancelado (0 provider), mesmo com probe 200",
    jResult.status === "cancelled");

  // K: cross-tenant — probe/sinal de A nunca autoriza B.
  await seedStore("probe-k-a");
  await seedStore("probe-k-b");
  await seedScheduledJob("probe-k-a");
  await seedScheduledJob("probe-k-b");
  await recordBillingAccessSignal("probe-k-a", false, now - 10 * 60 * 1000);
  await recordBillingAccessSignal("probe-k-b", false, now - 10 * 60 * 1000);
  const kACalls: ProbeCall[] = [];
  await dispatchJob("probe-k-a", "job-1", fakeFetch("active", kACalls)); // A fica liberada
  const kBCalls: ProbeCall[] = [];
  const kBResult = await dispatchJob("probe-k-b", "job-1", fakeFetch("blocked", kBCalls)); // B tem seu proprio probe
  check("K acesso liberado de A nao vaza para B (B recusado pelo seu proprio probe)",
    kBResult.status === "cancelled" && kBCalls.length === 1);
  const kACache = await getStoreCommercialCache("probe-k-a");
  const kBCache = await getStoreCommercialCache("probe-k-b");
  check("K caches de A e B sao independentes", kACache?.billingBlocked === false && kBCache?.billingBlocked === true);

  // L: WhatsApp test segue a MESMA regra — cache positiva antiga nao basta,
  // exige probe atual (ou sinal desta execucao).
  await seedStore("probe-wa");
  await recordBillingAccessSignal("probe-wa", false, now - (4 * 60 * 1000)); // "liberado" ha 4 min
  const waCalls: ProbeCall[] = [];
  const waBlocked = await claimWhatsappTestAttempt("probe-wa", now, fakeFetch("blocked", waCalls));
  check("L WhatsApp test: cache positiva antiga nao basta, probe atual 402 => bloqueado",
    !waBlocked.ok && waBlocked.status === 402 && waCalls.length === 1);
  const waLimitDoc = await db.doc("stores/probe-wa/whatsapp_test_limits/global").get();
  check("L teste bloqueado nao consome janela de rate limit", !waLimitDoc.exists);

  // M: reuso de sinal 2xx da MESMA execucao so vale para o MESMO storeId —
  // um sinal de outra store (mesmo recente) e sempre ignorado e forca probe;
  // um sinal da PROPRIA store, dentro da janela, dispensa probe novo.
  await seedStore("probe-m");
  const mCallsWrongStore: ProbeCall[] = [];
  const mWrongStoreState = await ensureFreshCommercialAccess(
    "probe-m", "fake-token", now, fakeFetch("blocked", mCallsWrongStore),
    { storeId: "outra-store-qualquer", observedAt: now - 100, result: "active" },
  );
  check("M sinal de OUTRA store nunca e reaproveitado (probe proprio foi feito)",
    mCallsWrongStore.length === 1 && mWrongStoreState === "commercial_access_blocked");

  const mCallsRightStore: ProbeCall[] = [];
  const mRightStoreState = await ensureFreshCommercialAccess(
    "probe-m", "fake-token", now, fakeFetch("active", mCallsRightStore),
    { storeId: "probe-m", observedAt: now - 100, result: "active" },
  );
  check("M sinal da MESMA store dentro da janela dispensa novo probe",
    mCallsRightStore.length === 0 && mRightStoreState === "commercial_access_active");

  // O primeiro caso (M/store errada) ja deixou "probe-m" com cache negativa
  // real (o probe verdadeiro respondeu 402) — por isso este terceiro caso
  // usa uma store fresca, sem nenhuma cache previa, para provar isoladamente
  // que um sameExecutionSignal EXPIRADO (fora da janela) e descartado e
  // forca um probe novo, em vez de ser aceito as cegas.
  await seedStore("probe-m-expired");
  const mCallsExpired: ProbeCall[] = [];
  const mExpiredState = await ensureFreshCommercialAccess(
    "probe-m-expired", "fake-token", now, fakeFetch("blocked", mCallsExpired),
    { storeId: "probe-m-expired", observedAt: now - SAME_EXECUTION_SIGNAL_REUSE_MS - 1, result: "active" },
  );
  check("M sinal da mesma store porem fora da janela de reuso forca novo probe",
    mCallsExpired.length === 1 && mExpiredState === "commercial_access_blocked");

  console.log(`\n${passed} testes de guarda final sem confianca em cache positivo (Billing V1) no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("Billing final-guard probe Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
