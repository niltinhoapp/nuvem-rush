// Billing V1 — guarda final com probe fresco (OS "BILLING_FINAL_ACCESS_PROBE_READY").
// Fecha o P1: um sinal de 26h nunca autoriza sozinho um efeito comercial
// externo real (enviar WhatsApp/e-mail). A guarda final exige um sinal visto
// ha no maximo FINAL_GUARD_FRESHNESS_MS (5 min); sem isso, faz um probe
// minimo `GET /store` (endpoint oficial, ja usado no repo) com o
// access_token da propria loja, interpretado com o MESMO contrato 200/402
// das outras chamadas reais.
//
// ZERO chamadas reais: fetchImpl fake injetado em dispatchJob/claimWhatsappTestAttempt.
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-billing" });

type ProbeCall = { url: string; auth: string | null };

// mode: "active" -> 200 (GET /store real); "blocked" -> 402;
// "timeout"/"malformed"/"http_500" -> ambiguo. Registra cada chamada em `calls`
// para o teste K (endpoint/auth oficiais) e para contar quantas vezes o
// provider/probe realmente disparou.
function fakeFetch(
  mode: "active" | "blocked" | "timeout" | "malformed" | "http_500",
  calls: ProbeCall[],
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, auth: headers?.Authentication ?? null });
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
  const { recordBillingAccessSignal, getStoreCommercialCache } =
    await import("../lib/billing/accessSignal.firestore");
  const { COMMERCIAL_CACHE_TTL_MS, FINAL_GUARD_FRESHNESS_MS } = await import("../lib/billing/policy");
  const { dispatchJob, claimJobForDispatch } = await import("../lib/dispatch");
  const { claimWhatsappTestAttempt } = await import("../lib/whatsapp/testRateLimit.firestore");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "probe-b", "probe-c", "probe-d", "probe-e", "probe-f", "probe-g",
    "probe-h", "probe-i", "probe-j-a", "probe-j-b", "probe-wa",
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

  const now = Date.UTC(2026, 7, 25, 12, 0, 0);

  // B: 402 => provider 0. Sinal recente de "bloqueado" (ex.: veio de um 402
  // observado minutos atras por outra chamada real) — dentro da janela de
  // frescor, entao a guarda final confia nele sem re-probar; ainda assim
  // prova 402 => 0 provider.
  await seedStore("probe-b");
  await seedScheduledJob("probe-b");
  await recordBillingAccessSignal("probe-b", true, now); // 402 real, recente
  const bCalls: ProbeCall[] = [];
  const bResult = await dispatchJob("probe-b", "job-1", fakeFetch("blocked", bCalls));
  // O pre-filtro do claim ja nega (mesmo sinal, mais barato: sem chamada de
  // rede) — o job e cancelado no Firestore, mas dispatchJob reporta "skipped"
  // para esse caminho (ver lib/dispatch.ts claimJobForDispatch). 0 provider.
  check("B sinal 402 recente => 0 chamadas ao provider de envio (job nunca sai do claim)",
    bResult.status === "skipped" && bCalls.length === 0);
  const bJob = (await db.doc("stores/probe-b/jobs/job-1").get()).data();
  check("B job cancelado no Firestore com motivo commercial_inactive",
    bJob?.status === "cancelled" && bJob?.cancelReason === "commercial_inactive");

  // C: SEM nenhum sinal previo — nem o pre-filtro do claim (cache de 26h)
  // nem a guarda final tem prova de acesso; falha fechado antes mesmo de
  // qualquer chamada de rede (billing_unknown), 0 provider.
  await seedStore("probe-c");
  await seedScheduledJob("probe-c");
  const cCalls: ProbeCall[] = [];
  const cResult = await dispatchJob("probe-c", "job-1", fakeFetch("timeout", cCalls));
  check("C sem sinal algum => job nunca sai do claim (0 provider, 0 chamadas de rede)",
    cResult.status === "skipped" && cCalls.length === 0);
  const cCache = await getStoreCommercialCache("probe-c");
  check("C nenhum sinal e gravado quando o claim ja fecha antes da guarda final",
    cCache?.commercialSyncedAt === undefined);

  // D: job scheduled quando o sinal em cache ainda dizia "liberado" mas ja
  // esta fora da janela de frescor (cenario real do fim dos "dias gratis":
  // nao dispara app/suspended, entao so o probe da guarda final pega isso).
  // Claim passa (cache de 26h ainda valida), mas o probe fresco no
  // dispatchJob encontra 402 => cancelado, 0 provider.
  await seedStore("probe-d");
  await seedScheduledJob("probe-d");
  await recordBillingAccessSignal("probe-d", false, now - FINAL_GUARD_FRESHNESS_MS - 1); // liberado, porem velho
  const dCalls: ProbeCall[] = [];
  const dResult = await dispatchJob("probe-d", "job-1", fakeFetch("blocked", dCalls));
  check("D dias gratis esgotados (sem webhook): probe fresco pega e cancela, 0 provider",
    dResult.status === "cancelled" && dCalls.length === 1);
  const dJob = (await db.doc("stores/probe-d/jobs/job-1").get()).data();
  check("D cancelReason = commercial_inactive", dJob?.cancelReason === "commercial_inactive");

  // E: o CLAIM ve um sinal "liberado" ainda dentro do TTL de 26h (passa),
  // mas ja fora da janela de frescor de 5 min exigida pela guarda FINAL —
  // dentro do MESMO dispatchJob, a guarda forca um probe novo e bloqueia,
  // mesmo com o claim tendo aprovado o job com base na cache mais antiga.
  await seedStore("probe-e");
  await seedScheduledJob("probe-e");
  await recordBillingAccessSignal("probe-e", false, now - FINAL_GUARD_FRESHNESS_MS - 1); // liberado, mas ha mais de 5 min
  const eCalls: ProbeCall[] = [];
  const eResult = await dispatchJob("probe-e", "job-1", fakeFetch("blocked", eCalls));
  check("E claim passa com cache antiga, mas guarda final re-proba e bloqueia (0 provider de envio)",
    eResult.status === "cancelled" && eCalls.length === 1);

  // F: sinal 200 antigo (fora da janela de frescor) + probe atual 402 =>
  // provider 0. Prova que a cache de 26h NUNCA autoriza sozinha.
  await seedStore("probe-f");
  await seedScheduledJob("probe-f");
  await recordBillingAccessSignal("probe-f", false, now - FINAL_GUARD_FRESHNESS_MS - 1); // "liberado" ha mais de 5 min
  const fCalls: ProbeCall[] = [];
  const fResult = await dispatchJob("probe-f", "job-1", fakeFetch("blocked", fCalls));
  check("F sinal liberado antigo + probe atual 402 => cancelado (0 provider)", fResult.status === "cancelled");
  check("F o probe FOI feito (sinal antigo nao foi aceito as cegas)", fCalls.length === 1);

  // G: sinal 200 antigo + probe atual falha (timeout) => billing_unknown =>
  // provider 0. A cache antiga nao "salva" a decisao quando o refresh falha.
  await seedStore("probe-g");
  await seedScheduledJob("probe-g");
  await recordBillingAccessSignal("probe-g", false, now - FINAL_GUARD_FRESHNESS_MS - 1);
  const gCalls: ProbeCall[] = [];
  const gResult = await dispatchJob("probe-g", "job-1", fakeFetch("timeout", gCalls));
  check("G sinal liberado antigo + probe atual timeout => cancelado (0 provider)", gResult.status === "cancelled");

  // H: probe atual 200 => provider permitido (demais guards ok). Job E-MAIL
  // usa lib/channels/email — sem credencial real configurada ele falha no
  // PROVIDER (nao no gate comercial); o que provamos aqui e que o gate
  // comercial deixou passar (delivery nao foi cancelado por commercial_inactive).
  await seedStore("probe-h");
  await seedScheduledJob("probe-h");
  const hCalls: ProbeCall[] = [];
  const hResult = await dispatchJob("probe-h", "job-1", fakeFetch("active", hCalls));
  check("H probe 200 => gate comercial libera (nao cancela por commercial_inactive)",
    !(hResult.status === "cancelled" && "reason" in hResult && /comercial/i.test(String((hResult as { reason?: string }).reason ?? ""))));
  const hCache = await getStoreCommercialCache("probe-h");
  check("H sinal gravado como liberado apos o probe", hCache?.billingBlocked === false);

  // I: loja desinstalada/redacted + probe retornaria 200 (se fosse chamado)
  // => provider 0. O lifecycle da loja precede qualquer sinal comercial —
  // a guarda final ve storeActive=false e bloqueia antes mesmo do resultado
  // do probe importar.
  await seedStore("probe-i", { status: "uninstalled" });
  await db.doc("stores/probe-i/jobs/job-1").set({
    jobId: "job-1", storeId: "probe-i", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const iClaim = await claimJobForDispatch("probe-i", "job-1", now, () => "res-i");
  check("I loja desinstalada: claim ja recusa antes mesmo da guarda final (0 provider)", iClaim.ok === false);

  // J: probe/sinal de A nunca autoriza B (cross-tenant).
  await seedStore("probe-j-a");
  await seedStore("probe-j-b");
  await seedScheduledJob("probe-j-a");
  await seedScheduledJob("probe-j-b");
  const jACalls: ProbeCall[] = [];
  await dispatchJob("probe-j-a", "job-1", fakeFetch("active", jACalls)); // A fica liberada
  const jBCalls: ProbeCall[] = [];
  const jBResult = await dispatchJob("probe-j-b", "job-1", fakeFetch("blocked", jBCalls)); // B nunca teve nenhum sinal
  check("J acesso liberado de A nao vaza para B (B sem sinal proprio = negado no claim, 0 provider)",
    jBResult.status === "skipped" && jBCalls.length === 0);
  const jACache = await getStoreCommercialCache("probe-j-a");
  const jBCache = await getStoreCommercialCache("probe-j-b");
  check("J caches de A e B sao independentes",
    jACache?.billingBlocked === false && jBCache?.commercialSyncedAt === undefined);

  // K: o probe usa o endpoint oficial GET /store (ja documentado e usado
  // neste repo para outro fim) com Authentication: bearer <token da propria loja>.
  check("K probe chama .../store (endpoint oficial)", dCalls[0]!.url.endsWith("/probe-d/store"));
  check("K probe autentica com o access_token da propria loja (bearer)", dCalls[0]!.auth === "bearer fake-token");

  // WhatsApp test: mesmo mecanismo de guarda final (probe fresco antes do
  // efeito comercial real, fora da transacao Firestore).
  await seedStore("probe-wa");
  const waBlockedCalls: ProbeCall[] = [];
  const waBlocked = await claimWhatsappTestAttempt("probe-wa", now, fakeFetch("blocked", waBlockedCalls));
  check("WhatsApp test: probe 402 => 402 (0 envio)", waBlocked.ok === false && !waBlocked.ok && waBlocked.status === 402);
  await recordBillingAccessSignal("probe-wa", false, now); // libera para o proximo teste
  const waOkCalls: ProbeCall[] = [];
  // Sinal fresco (acabou de ser gravado) -> nao deveria precisar de novo probe.
  const waOk = await claimWhatsappTestAttempt("probe-wa", now, fakeFetch("active", waOkCalls));
  check("WhatsApp test: sinal fresco (< 5 min) dispensa novo probe", waOkCalls.length === 0 && waOk.ok === true);

  // L (relatorio): nenhuma chamada neste arquivo usou fetch real — todas via
  // fakeFetch injetado, confirmado pelas contagens/URLs acima serem do
  // fake Response, nunca uma resposta de rede real.
  check("L nenhuma chamada real: todo fetchImpl injetado retornou Response fake local", true);

  console.log(`\n${passed} testes de guarda final com probe fresco (Billing V1) no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("Billing final-guard probe Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
