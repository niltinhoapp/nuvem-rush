import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST obrigatorio");
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-nuvem-rush-provider-abuse" });

async function main() {
  const db = getFirestore();
  const { claimWhatsappTestAttempt } = await import("../lib/whatsapp/testRateLimit.firestore");
  const { WHATSAPP_TEST_COOLDOWN_MS } = await import("../lib/whatsapp/testRateLimit");
  const {
    claimJobForDispatch,
    finalizeClaimedDispatch,
    recoverOrphanProcessingJobs,
  } = await import("../lib/dispatch");
  const { cancelJobAndReleaseQuota } = await import("../lib/dispatch/cancel");
  const { PROCESSING_TIMEOUT_MS } = await import("../lib/dispatch/claim");

  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  const stores = ["rate-a", "rate-b", "rate-inactive", "quota-a", "quota-full", "quota-success", "quota-stale", "quota-orphan"];
  for (const storeId of stores) await db.recursiveDelete(db.doc(`stores/${storeId}`));

  async function seedStore(storeId: string, options: { status?: string; used?: number; limit?: number } = {}) {
    await db.doc(`stores/${storeId}`).set({
      storeId,
      status: options.status ?? "active",
      quotas: {
        periodKey: "2026-08",
        dispatchesMonthUsed: options.used ?? 99,
        dispatchesMonthReserved: 0,
        dispatchesMonthLimit: options.limit ?? 100,
        whatsappMonthUsed: 0,
        whatsappMonthReserved: 0,
        whatsappMonthLimit: 100,
      },
    });
  }

  function job(storeId: string, jobId: string) {
    return db.doc(`stores/${storeId}/jobs/${jobId}`).set({
      jobId,
      storeId,
      enrollmentId: "fixture-enrollment",
      flowId: "fixture-flow",
      stepIndex: 0,
      channel: "email",
      runAt: now,
      status: "scheduled",
    });
  }

  // Test endpoint: limite e cooldown sao tenant-scoped e transacionais.
  await seedStore("rate-a");
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => claimWhatsappTestAttempt("rate-a", now)));
  assert.equal(concurrent.filter((result) => result.ok).length, 1, "concorrencia nao atravessa cooldown");
  for (let i = 1; i < 10; i++) {
    assert.equal((await claimWhatsappTestAttempt("rate-a", now + i * WHATSAPP_TEST_COOLDOWN_MS)).ok, true);
  }
  const eleventh = await claimWhatsappTestAttempt("rate-a", now + 10 * WHATSAPP_TEST_COOLDOWN_MS);
  assert.deepEqual(eleventh, { ok: false, status: 429, reason: "daily_limit" });
  await seedStore("rate-b");
  assert.equal((await claimWhatsappTestAttempt("rate-b", now)).ok, true, "stores independentes");
  await seedStore("rate-inactive", { status: "uninstalled" });
  assert.deepEqual(await claimWhatsappTestAttempt("rate-inactive", now), {
    ok: false, status: 409, reason: "store_inactive",
  });

  // Cota comercial real: dez jobs no ultimo slot obtêm no máximo uma reserva.
  await seedStore("quota-a");
  await Promise.all(Array.from({ length: 10 }, (_, i) => job("quota-a", `job-${i}`)));
  const claims = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    claimJobForDispatch("quota-a", `job-${i}`, now, () => `reservation-${i}`),
  ));
  assert.equal(claims.filter((claim) => claim.ok).length, 1, "99/100 bloqueia nove claims concorrentes");
  const quotaA = (await db.doc("stores/quota-a").get()).data()?.quotas;
  assert.equal(quotaA?.dispatchesMonthUsed, 99);
  assert.equal(quotaA?.dispatchesMonthReserved, 1);
  const winner = claims.findIndex((claim) => claim.ok);
  assert.ok(winner >= 0);
  assert.equal(await cancelJobAndReleaseQuota({
    storeId: "quota-a",
    jobRef: db.doc(`stores/quota-a/jobs/job-${winner}`),
    reason: "fixture_failure",
    now: now + 1,
    expectedStatus: "processing",
  }), true, "falha/cancelamento libera uma reserva");
  assert.equal(await cancelJobAndReleaseQuota({
    storeId: "quota-a",
    jobRef: db.doc(`stores/quota-a/jobs/job-${winner}`),
    reason: "duplicate",
    now: now + 2,
  }), false, "release duplicado e no-op");
  const quotaAfterRelease = (await db.doc("stores/quota-a").get()).data()?.quotas;
  assert.equal(quotaAfterRelease?.dispatchesMonthReserved, 0);
  assert.equal(quotaAfterRelease?.dispatchesMonthUsed, 99);

  await seedStore("quota-full", { used: 100 });
  await job("quota-full", "job-full");
  assert.equal((await claimJobForDispatch("quota-full", "job-full", now, () => "never")).ok, false,
    "used=100 inicia zero providers/reservas");

  // Sucesso atomico: a mesma reserva decrementa reserved e incrementa used.
  await seedStore("quota-success");
  await job("quota-success", "job-success");
  await db.doc("stores/quota-success/enrollments/fixture-enrollment").set({ status: "active" });
  const successClaim = await claimJobForDispatch("quota-success", "job-success", now, () => "success-1");
  assert.equal(successClaim.ok, true);
  if (!successClaim.ok) throw new Error("claim fixture falhou");
  assert.deepEqual(await finalizeClaimedDispatch("quota-success", "job-success", successClaim.reservationId), { ok: true });
  const successStore = (await db.doc("stores/quota-success").get()).data()?.quotas;
  const successJob = (await db.doc("stores/quota-success/jobs/job-success").get()).data();
  assert.equal(successStore?.dispatchesMonthUsed, 100);
  assert.equal(successStore?.dispatchesMonthReserved, 0);
  assert.equal(successJob?.status, "sent");

  // Fencing: um worker antigo nao pode concluir a reserva assumida no retry.
  await seedStore("quota-stale");
  await job("quota-stale", "job-stale");
  await db.doc("stores/quota-stale/enrollments/fixture-enrollment").set({ status: "active" });
  const firstClaim = await claimJobForDispatch("quota-stale", "job-stale", now, () => "stale-1");
  assert.equal(firstClaim.ok, true);
  if (!firstClaim.ok) throw new Error("first stale fixture claim failed");
  assert.equal(await cancelJobAndReleaseQuota({
    storeId: "quota-stale",
    jobRef: db.doc("stores/quota-stale/jobs/job-stale"),
    reason: "fixture_retry",
    now: now + 1,
    expectedStatus: "processing",
  }), true);
  await db.doc("stores/quota-stale/jobs/job-stale").update({ status: "scheduled" });
  const retryClaim = await claimJobForDispatch("quota-stale", "job-stale", now + 60_000, () => "stale-2");
  assert.equal(retryClaim.ok, true);
  if (!retryClaim.ok) throw new Error("retry stale fixture claim failed");
  assert.deepEqual(
    await finalizeClaimedDispatch("quota-stale", "job-stale", firstClaim.reservationId),
    { ok: false, storeActive: true, jobStatus: "processing", enrollmentActive: true },
    "worker stale nao finaliza depois de perder ownership",
  );
  assert.deepEqual(await finalizeClaimedDispatch("quota-stale", "job-stale", retryClaim.reservationId), { ok: true });

  // Worker morto depois do claim: a recuperacao libera exatamente a reserva e
  // reabre o job, sem contador negativo.
  await seedStore("quota-orphan");
  await job("quota-orphan", "job-orphan");
  const orphanClaim = await claimJobForDispatch("quota-orphan", "job-orphan", now, () => "orphan-reservation");
  assert.equal(orphanClaim.ok, true);
  assert.equal(await recoverOrphanProcessingJobs("quota-orphan", now + PROCESSING_TIMEOUT_MS), 1);
  const orphanStore = (await db.doc("stores/quota-orphan").get()).data()?.quotas;
  const orphanJob = (await db.doc("stores/quota-orphan/jobs/job-orphan").get()).data();
  assert.equal(orphanStore?.dispatchesMonthReserved, 0);
  assert.equal(orphanJob?.status, "scheduled");
  assert.equal(orphanJob?.quotaReservationId, undefined);

  console.log("Provider abuse + atomic quota Firestore Emulator: OK");
}

main().catch((error: unknown) => {
  console.error("Provider abuse + atomic quota Emulator test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
