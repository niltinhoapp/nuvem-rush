// Logica de disparo de um job (revalida, envia pelo canal, registra log).
// Reutilizada pelo cron da Vercel e pelo endpoint /api/dispatch.
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsapp } from "@/lib/channels/whatsapp";
import { applyTag } from "@/lib/channels/tag";
import { triggerWebhook } from "@/lib/channels/webhook";
import { canClaim, quotaUsageField, hasQuota, isOrphanProcessing } from "@/lib/dispatch/claim";
import { planRetry, MAX_ATTEMPTS } from "@/lib/dispatch/retry";
import type { Job, Flow, Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { runWithFinalCommercialGuard } from "@/lib/dispatch/finalGuard";

export type DispatchResult =
  | { ok: true; status: "sent" | "cancelled" | "skipped" | "failed"; reason?: string };

export async function dispatchJob(storeId: string, jobId: string): Promise<DispatchResult> {
  const jobRef = col(storeId, "jobs").doc(jobId);

  // Claim ATOMICO (B3): transacao compare-and-set scheduled -> processing.
  // Garante que dois crons/workers concorrentes nunca disparem o MESMO job:
  // apenas a transacao que le "scheduled" consegue escrever "processing"; a
  // outra le "processing" e desiste. Jobs ja processados (sent/failed/cancelled)
  // ou em processamento tambem sao ignorados.
  const claim = await db.runTransaction(async (tx) => {
    const storeSnap = await tx.get(storeRef(storeId));
    const snap = await tx.get(jobRef);
    if (!snap.exists) return { ok: false as const, reason: "job inexistente" };
    const j = snap.data() as Job;
    if (!isStoreCommerciallyActive(storeSnap.data()?.status)) {
      if (j.status === "scheduled" || j.status === "processing") {
        tx.update(jobRef, { status: "cancelled", cancelReason: "store_inactive" });
      }
      return { ok: false as const, reason: "loja inativa" };
    }
    if (!canClaim(j.status)) return { ok: false as const, reason: "ja processado" };
    tx.update(jobRef, { status: "processing", claimedAt: Date.now() });
    return { ok: true as const, job: j };
  });
  if (!claim.ok) return { ok: true, status: "skipped", reason: claim.reason };
  const job = claim.job;

  // Revalidacoes: enrollment ativo?
  const enroll = await col(storeId, "enrollments").doc(job.enrollmentId).get();
  if (!enroll.exists || enroll.data()!.status !== "active") {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "enrollment inativo" };
  }

  // Loja ativa?
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active") {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "loja inativa" };
  }

  // Reset mensal de cota (idempotente, sem cron): se o periodo (YYYY-MM) mudou
  // desde a ultima contagem, zera os contadores antes de checar a cota. Sem
  // isso, toda loja bate a cota no 2o mes e o app para silenciosamente.
  const periodKey = new Date().toISOString().slice(0, 7); // "2026-08"
  if (store.quotas.periodKey !== periodKey) {
    await storeRef(storeId).update({
      "quotas.periodKey": periodKey,
      "quotas.dispatchesMonthUsed": 0,
      "quotas.whatsappMonthUsed": 0,
    });
    store.quotas.dispatchesMonthUsed = 0;
    store.quotas.whatsappMonthUsed = 0;
    store.quotas.periodKey = periodKey;
  }

  const flow = (await col(storeId, "flows").doc(job.flowId).get()).data() as Flow | undefined;
  const step = flow?.steps[job.stepIndex];
  if (!step) {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "step inexistente" };
  }

  // Quota por canal: WhatsApp tem cota propria (cada msg custa ~R$0,33 na
  // Meta); e-mail usa a cota legada "dispatches".
  const isWhatsapp = step.action === "whatsapp";
  const quotaUsed = isWhatsapp
    ? (store.quotas.whatsappMonthUsed ?? 0)
    : store.quotas.dispatchesMonthUsed;
  const quotaLimit = isWhatsapp
    ? (store.quotas.whatsappMonthLimit ?? 0)
    : store.quotas.dispatchesMonthLimit;
  if (!hasQuota(quotaUsed, quotaLimit)) {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "quota do canal esgotada" };
  }

  // Guarda FINAL: as leituras ocorrem depois de todo bookkeeping auxiliar e o
  // provider e iniciado sem nenhum await entre a decisao e a chamada externa.
  const delivery = await runWithFinalCommercialGuard(
    async () => {
      const [preSendStore, preSendJob, preSendEnrollment] = await Promise.all([
        storeRef(storeId).get(),
        jobRef.get(),
        col(storeId, "enrollments").doc(job.enrollmentId).get(),
      ]);
      return {
        storeActive: isStoreCommerciallyActive(preSendStore.data()?.status),
        jobProcessing: preSendJob.data()?.status === "processing",
        enrollmentActive: preSendEnrollment.data()?.status === "active",
      };
    },
    async () => {
    if (step.action === "email") {
      await sendEmail({ storeId, enrollmentId: job.enrollmentId, step });
    } else if (step.action === "whatsapp") {
      await sendWhatsapp({ storeId, enrollmentId: job.enrollmentId, step });
    } else if (step.action === "tag") {
      await applyTag({ storeId, enrollmentId: job.enrollmentId, step });
    } else if (step.action === "webhook") {
      await triggerWebhook({ storeId, enrollmentId: job.enrollmentId, step });
    } else {
      // Acao sem canal implementado (ex.: "task"): falha explicita em vez de
      // marcar como "enviado" silenciosamente.
      throw new Error(`acao "${step.action}" nao implementada`);
    }
    },
  );

  if (delivery.status === "guard_failed") throw delivery.error;
  if (delivery.status === "blocked") {
    if (delivery.state.jobProcessing) {
      await jobRef.update({
        status: "cancelled",
        cancelReason: !delivery.state.storeActive ? "store_inactive" : "enrollment_inactive",
      });
    }
    return {
      ok: true,
      status: "cancelled",
      reason: !delivery.state.storeActive
        ? "loja inativa antes do envio"
        : !delivery.state.enrollmentActive
          ? "enrollment inativo antes do envio"
          : "job cancelado antes do envio",
    };
  }

  // APENAS falha do provider dispara retry. O bookkeeping pos-sucesso fica
  // fora: se falhar apos a mensagem sair, o job nao e reenviado.
  if (delivery.status === "effect_failed") {
    const err = delivery.error;
    // Falha de ENVIO: decide retry (transitorio) x falha terminal (permanente
    // ou tentativas esgotadas). Retry volta o job para "scheduled" com runAt no
    // futuro (backoff) — o cron ja filtra por runAt, entao nada mais muda.
    const plan = planRetry(job.attempts ?? 0, err, Date.now());
    if (plan.retry) {
      await jobRef.update({
        status: "scheduled",
        runAt: plan.nextAttemptAt,
        attempts: plan.attempts,
        lastError: String(err),
        nextAttemptAt: plan.nextAttemptAt,
      });
      await col(storeId, "logs").add({
        jobId, channel: step.action, status: "retry",
        attempt: plan.attempts, error: String(err), at: Date.now(),
      });
      return { ok: true, status: "failed", reason: `retry #${plan.attempts}: ${String(err)}` };
    }
    await jobRef.update({ status: "failed", attempts: plan.attempts, lastError: String(err) });
    await col(storeId, "logs").add({
      jobId, channel: step.action, status: "failed",
      attempt: plan.attempts, error: String(err), at: Date.now(),
    });
    return { ok: true, status: "failed", reason: String(err) };
  }

  // Finalizacao atomica: se o uninstall ocorreu enquanto o provider estava em
  // andamento, o handler ja cancelou o job e esta transacao NAO pode
  // sobrescrever cancelled com sent nem consumir cota.
  const finalized = await db.runTransaction(async (tx) => {
    const [finalStore, finalJob, finalEnrollment] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(jobRef),
      tx.get(col(storeId, "enrollments").doc(job.enrollmentId)),
    ]);
    if (
      !isStoreCommerciallyActive(finalStore.data()?.status)
      || finalJob.data()?.status !== "processing"
      || finalEnrollment.data()?.status !== "active"
    ) {
      return {
        ok: false as const,
        storeActive: isStoreCommerciallyActive(finalStore.data()?.status),
        jobStatus: finalJob.data()?.status,
        enrollmentActive: finalEnrollment.data()?.status === "active",
      };
    }
    tx.update(jobRef, { status: "sent" });
    tx.update(storeRef(storeId), {
      [quotaUsageField(isWhatsapp)]: FieldValue.increment(1),
    });
    return { ok: true as const };
  });
  if (!finalized.ok) {
    // O provider ja foi invocado; uma desinstalacao/cancelamento concorrente
    // nao pode desfazer o efeito externo. Preservamos cancelled e registramos
    // a limitacao sem consumir cota nem afirmar falsamente que o job foi sent.
    await col(storeId, "logs").add({
      jobId,
      channel: step.action,
      status: "provider_completed_not_finalized",
      storeActive: finalized.storeActive,
      jobStatus: finalized.jobStatus ?? "missing",
      enrollmentActive: finalized.enrollmentActive,
      at: Date.now(),
    });
    return { ok: true, status: "cancelled", reason: "provider iniciado antes do cancelamento" };
  }
  await col(storeId, "logs").add({
    jobId, channel: step.action, status: "sent", at: Date.now(),
  });
  return { ok: true, status: "sent" };
}

// Recupera jobs presos em "processing" (worker/funcao morreu apos o claim e
// antes de escrever o estado terminal). O maxDuration do cron e 60s, entao um
// job "processing" ha mais de PROCESSING_TIMEOUT_MS (10 min) certamente esta
// orfao. Devolve para "scheduled" para nova tentativa.
//
// Seguranca:
// - ATOMICO: a transacao rechecha isOrphanProcessing dentro do tx, entao dois
//   crons concorrentes nunca recuperam o mesmo job (o 2o le status != processing).
// - NUNCA toca "sent"/"failed"/"cancelled" (o filtro so pega "processing" antigo).
// - Preserva/incrementa attempts: a recuperacao conta como tentativa; esgotado
//   MAX_ATTEMPTS, marca "failed" (evita loop infinito de recuperacao).
export async function recoverOrphanProcessingJobs(
  storeId: string,
  now: number,
): Promise<number> {
  const snap = await col(storeId, "jobs")
    .where("status", "==", "processing")
    .limit(1000)
    .get();

  let recovered = 0;
  for (const d of snap.docs) {
    const job = d.data() as Job;
    if (!isOrphanProcessing(job.status, job.claimedAt, now)) continue;

    const ok = await db.runTransaction(async (tx) => {
      const s = await tx.get(d.ref);
      if (!s.exists) return false;
      const j = s.data() as Job;
      // Recheca dentro da transacao: se outro cron ja recuperou (status mudou),
      // desiste — sem duplicidade.
      if (!isOrphanProcessing(j.status, j.claimedAt, now)) return false;

      const attempts = (j.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        tx.update(d.ref, {
          status: "failed",
          attempts,
          lastError: "orfao em processing: tentativas esgotadas",
        });
      } else {
        tx.update(d.ref, {
          status: "scheduled",
          runAt: now,
          attempts,
          lastError: "recuperado de processing orfao",
          nextAttemptAt: now,
        });
      }
      return true;
    });
    if (ok) recovered++;
  }
  return recovered;
}
