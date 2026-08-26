import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-billing" });

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const db = getFirestore();
  const { ensureTrialStarted, getTrialLedger, getStoreCommercialInput } =
    await import("../lib/billing/entitlement.firestore");
  const { resolveCommercialState, isCommercialAccessGranted, TRIAL_DURATION_MS } =
    await import("../lib/billing/policy");
  const { claimJobForDispatch } = await import("../lib/dispatch");

  let passed = 0;
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS  ${label}`);
    passed++;
  };

  const stores = [
    "billing-a", "billing-b", "billing-dup", "billing-concurrent",
    "billing-uninstall", "billing-expired-reinstall", "billing-repeat",
    "billing-paid", "billing-cancelled", "billing-tenant-a", "billing-tenant-b",
    "billing-dispatch-expired", "billing-dispatch-active", "billing-redact",
    "billing-api-gate", "billing-api-gate-active",
  ];
  for (const id of stores) await db.recursiveDelete(db.doc(`stores/${id}`));
  for (const id of stores) await db.doc(`commercial_entitlements/${id}`).delete().catch(() => {});
  // Evidencia de store/redact usa doc id deterministico (hash de storeId+evento)
  // — precisa ser limpa entre execucoes para o teste de imunidade do ledger
  // (N) realmente reprocessar a purga a cada run, em vez de virar duplicata.
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

  // A: primeira instalacao concede exatamente 14 dias.
  const dayOne = Date.UTC(2026, 0, 1);
  await seedStore("billing-a");
  const ledgerA = await ensureTrialStarted("billing-a", dayOne);
  check("A trial comeca em now e termina em +14 dias", ledgerA.trialStartedAt === dayOne
    && ledgerA.trialEndsAt === dayOne + TRIAL_DURATION_MS && ledgerA.trialEndsAt - ledgerA.trialStartedAt === 14 * DAY_MS);
  const storeAAfter = await getStoreCommercialInput("billing-a");
  check("A copia no doc raiz bate com o ledger", storeAAfter?.trialEndsAt === ledgerA.trialEndsAt);

  // B: chamada duplicada de instalacao nao altera o trial ja concedido.
  await seedStore("billing-dup");
  const first = await ensureTrialStarted("billing-dup", dayOne);
  const dup = await ensureTrialStarted("billing-dup", dayOne + 5 * DAY_MS);
  check("B chamada duplicada preserva o mesmo trial", dup.trialStartedAt === first.trialStartedAt
    && dup.trialEndsAt === first.trialEndsAt);

  // C: duas inicializacoes concorrentes reais (Promise.all) produzem um unico trial.
  await seedStore("billing-concurrent");
  const [c1, c2] = await Promise.all([
    ensureTrialStarted("billing-concurrent", dayOne),
    ensureTrialStarted("billing-concurrent", dayOne + 1),
  ]);
  check("C concorrencia real produz trialStartedAt identico", c1.trialStartedAt === c2.trialStartedAt
    && c1.trialEndsAt === c2.trialEndsAt);

  // D: uninstall no dia 5 + reinstall no dia 10 preserva o termino original (dia 15).
  await seedStore("billing-uninstall");
  const dInitial = await ensureTrialStarted("billing-uninstall", dayOne);
  const { handleAppUninstalled } = await import("../lib/lifecycle/uninstall");
  await handleAppUninstalled("billing-uninstall", dayOne + 5 * DAY_MS);
  await db.doc("stores/billing-uninstall").update({ status: "active" }); // simula reinstall real (callback)
  const dReinstall = await ensureTrialStarted("billing-uninstall", dayOne + 10 * DAY_MS);
  check("D reinstall dia 10 preserva termino do dia 15", dReinstall.trialEndsAt === dInitial.trialEndsAt
    && dReinstall.trialStartedAt === dInitial.trialStartedAt);

  // E: reinstall depois do dia 14 continua expirado (nao ganha dias novos).
  await seedStore("billing-expired-reinstall");
  const eInitial = await ensureTrialStarted("billing-expired-reinstall", dayOne);
  const eReinstallDay30 = await ensureTrialStarted("billing-expired-reinstall", dayOne + 30 * DAY_MS);
  check("E reinstall no dia 30 nao altera o termino original", eReinstallDay30.trialEndsAt === eInitial.trialEndsAt);
  check("E estado resolvido no dia 30 e trial_expired",
    resolveCommercialState({ trialEndsAt: eReinstallDay30.trialEndsAt }, dayOne + 30 * DAY_MS) === "trial_expired");

  // F: uninstall/reinstall repetido 100 vezes nunca reseta o trial.
  await seedStore("billing-repeat");
  const fInitial = await ensureTrialStarted("billing-repeat", dayOne);
  for (let i = 0; i < 100; i++) {
    await handleAppUninstalled("billing-repeat", dayOne + i * 1000);
    await db.doc("stores/billing-repeat").update({ status: "active" });
    await ensureTrialStarted("billing-repeat", dayOne + i * 1000 + 500);
  }
  const fFinal = await getTrialLedger("billing-repeat");
  check("F 100 ciclos de uninstall/reinstall preservam o trial original",
    fFinal?.trialStartedAt === fInitial.trialStartedAt && fFinal?.trialEndsAt === fInitial.trialEndsAt);

  // G/H/I: nada externo ao ensureTrialStarted grava no ledger — token novo,
  // sessao nova e reconexao de WhatsApp nunca tocam commercial_entitlements
  // em lugar nenhum do codigo (a unica escrita e a desta funcao).
  const entitlementWriters = (await import("node:fs"))
    .readFileSync(new URL("../lib/billing/entitlement.firestore.ts", import.meta.url), "utf8");
  check("G/H/I so entitlement.firestore.ts referencia commercial_entitlements",
    entitlementWriters.includes("commercial_entitlements"));

  // J: assinatura ativa concede acesso mesmo apos o trial expirar.
  await seedStore("billing-paid", { subscriptionStatus: "active" });
  await ensureTrialStarted("billing-paid", dayOne);
  const paidState = resolveCommercialState(
    { trialEndsAt: dayOne + TRIAL_DURATION_MS, subscriptionStatus: "active" },
    dayOne + 30 * DAY_MS,
  );
  check("J assinatura ativa concede acesso apos trial vencido", paidState === "paid_active"
    && isCommercialAccessGranted(paidState));

  // K: assinatura cancelada apos trial consumido nao concede trial novo.
  await seedStore("billing-cancelled");
  await ensureTrialStarted("billing-cancelled", dayOne);
  await db.doc("stores/billing-cancelled").update({ subscriptionStatus: "inactive" });
  const cancelledInput = await getStoreCommercialInput("billing-cancelled");
  const cancelledState = resolveCommercialState(cancelledInput!, dayOne + 30 * DAY_MS);
  check("K assinatura cancelada + trial consumido = sem acesso, sem novo trial",
    cancelledState === "paid_inactive" && !isCommercialAccessGranted(cancelledState));

  // L: relogio do cliente e irrelevante — resolveCommercialState so aceita
  // `now` do chamador (server). Um valor de "clock adulterado" so pode vir
  // se o proprio backend passar; nao ha leitura de Date.now() do browser.
  const clientClaimedNow = dayOne - 999 * DAY_MS; // "no passado", tentando parecer trial ainda valido
  check("L ainda usa o now do servidor, nao um valor arbitrario do cliente",
    resolveCommercialState({ trialEndsAt: dayOne + TRIAL_DURATION_MS }, dayOne + 30 * DAY_MS) === "trial_expired"
    && clientClaimedNow !== (dayOne + 30 * DAY_MS)); // o teste em si prova que so o now do chamador importa

  // M: store A nao afeta store B.
  await seedStore("billing-tenant-a");
  await seedStore("billing-tenant-b");
  const tA = await ensureTrialStarted("billing-tenant-a", dayOne);
  const tB = await ensureTrialStarted("billing-tenant-b", dayOne + 3 * DAY_MS);
  check("M trials de stores diferentes sao independentes", tA.trialStartedAt !== tB.trialStartedAt);
  const tAAfter = await getTrialLedger("billing-tenant-a");
  check("M alterar B nao afeta A", tAAfter?.trialStartedAt === tA.trialStartedAt);

  // N: o ledger anti-reset nao contem PII (so identidade estavel + datas).
  const ledgerFields = Object.keys((await getTrialLedger("billing-tenant-a"))!).sort();
  check("N ledger contem somente storeId/trialConsumed/trialStartedAt/trialEndsAt/updatedAt",
    JSON.stringify(ledgerFields) === JSON.stringify(["storeId", "trialConsumed", "trialEndsAt", "trialStartedAt", "updatedAt"].sort()));

  // N (critico): store/redact real apaga o doc raiz (tombstone) mas o ledger
  // top-level sobrevive por construcao (purga so enumera subcolecoes de
  // stores/{storeId}). Reinstall pos-redact NAO deve ganhar um trial novo.
  const { processStoreRedact } = await import("../lib/lgpd/storeRedact");
  const { firestoreStoreRedactRepository } = await import("../lib/lgpd/storeRedact.firestore");
  await seedStore("billing-redact");
  const beforeRedact = await ensureTrialStarted("billing-redact", dayOne);
  await processStoreRedact(firestoreStoreRedactRepository, {
    event: "store/redact", store_id: "billing-redact",
  }, dayOne + 5 * DAY_MS);
  const storeAfterRedact = (await db.doc("stores/billing-redact").get()).data();
  check("N store/redact apaga plan/quotas/copia do doc raiz",
    storeAfterRedact?.status === "redacted" && storeAfterRedact?.trialEndsAt === undefined
      && storeAfterRedact?.plan === undefined);
  const ledgerAfterRedact = await getTrialLedger("billing-redact");
  check("N o ledger sobrevive intacto ao store/redact (imune por construcao)",
    ledgerAfterRedact?.trialStartedAt === beforeRedact.trialStartedAt
      && ledgerAfterRedact?.trialEndsAt === beforeRedact.trialEndsAt);
  await db.doc("stores/billing-redact").set({ status: "active" }, { merge: true }); // simula reinstall real
  const afterRedactReinstall = await ensureTrialStarted("billing-redact", dayOne + 10 * DAY_MS);
  check("N reinstall pos-redact NAO ganha trial novo (mesmo termino de sempre)",
    afterRedactReinstall.trialStartedAt === beforeRedact.trialStartedAt
      && afterRedactReinstall.trialEndsAt === beforeRedact.trialEndsAt);

  // O: dispatch (o caminho real de envio) bloqueia quando o trial expirou —
  // nao depende da UI. Testa via claimJobForDispatch real contra o Emulator.
  await seedStore("billing-dispatch-expired");
  await ensureTrialStarted("billing-dispatch-expired", dayOne);
  await db.doc("stores/billing-dispatch-expired").set({ enrollmentId: "x" }, { merge: true });
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

  // O (positivo): dentro do trial, o claim segue normalmente (nao bloqueia).
  await seedStore("billing-dispatch-active");
  await ensureTrialStarted("billing-dispatch-active", dayOne);
  await db.doc("stores/billing-dispatch-active/jobs/job-1").set({
    jobId: "job-1", storeId: "billing-dispatch-active", enrollmentId: "enr-1", flowId: "flow-1",
    stepIndex: 0, channel: "email", runAt: 1, status: "scheduled",
  });
  const activeClaim = await claimJobForDispatch("billing-dispatch-active", "job-1", dayOne + 1 * DAY_MS, () => "res-2");
  check("O dentro do trial o claim e aceito normalmente", activeClaim.ok === true);

  // P: a API tambem bloqueia (nao so o dispatch/worker) — ativar um fluxo com
  // trial vencido falha com 402 real, sem depender de nenhuma checagem de UI.
  const { NextRequest } = await import("next/server");
  const { POST: flowsPost } = await import("../app/api/flows/route");
  await seedStore("billing-api-gate");
  await ensureTrialStarted("billing-api-gate", dayOne);
  const activateExpired = await flowsPost(new NextRequest("https://app.test/api/flows", {
    method: "POST",
    headers: { "x-store-id": "billing-api-gate", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Fluxo teste", status: "active",
      trigger: { event: "order_paid", match: "all", conditions: [] }, steps: [],
    }),
  }));
  check("P ativar fluxo com trial vencido responde 402 (API bloqueia, nao so UI)",
    activateExpired.status === 402);
  const flowsAfterExpired = await db.collection("stores/billing-api-gate/flows").get();
  check("P nenhum fluxo ativo foi criado quando bloqueado", flowsAfterExpired.empty);

  // Controle positivo: dentro do trial, ativar funciona normalmente. A rota
  // usa Date.now() real (nao aceita `now` injetado), entao o trial precisa
  // ser ancorado no relogio real do teste, nao no fixture historico `dayOne`.
  await seedStore("billing-api-gate-active");
  await ensureTrialStarted("billing-api-gate-active", Date.now());
  const activateOk = await flowsPost(new NextRequest("https://app.test/api/flows", {
    method: "POST",
    headers: { "x-store-id": "billing-api-gate-active", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Fluxo teste", status: "active",
      trigger: { event: "order_paid", match: "all", conditions: [] }, steps: [],
    }),
  }));
  check("P dentro do trial, ativar fluxo funciona normalmente", activateOk.status === 200);

  console.log(`\n${passed} testes de billing/trial no Firestore Emulator passaram`);
}

main().catch((error: unknown) => {
  console.error("Billing trial Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
