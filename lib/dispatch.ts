// Logica de disparo de um job (revalida, envia pelo canal, registra log).
// Reutilizada pelo cron da Vercel e pelo endpoint /api/dispatch.
import { FieldValue } from "firebase-admin/firestore";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsapp } from "@/lib/channels/whatsapp";
import { applyTag } from "@/lib/channels/tag";
import { triggerWebhook } from "@/lib/channels/webhook";
import { canClaim, quotaUsageField, hasQuota } from "@/lib/dispatch/claim";
import type { Job, Flow, Store } from "@/types";

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
    const snap = await tx.get(jobRef);
    if (!snap.exists) return { ok: false as const, reason: "job inexistente" };
    const j = snap.data() as Job;
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

  try {
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

    await jobRef.update({ status: "sent" });
    // Incremento ATOMICO da cota (B6): FieldValue.increment evita o
    // read-modify-write concorrente (lost updates) do codigo anterior.
    await storeRef(storeId).update({
      [quotaUsageField(isWhatsapp)]: FieldValue.increment(1),
    });
    await col(storeId, "logs").add({
      jobId, channel: step.action, status: "sent", at: Date.now(),
    });
    return { ok: true, status: "sent" };
  } catch (err) {
    await jobRef.update({ status: "failed" });
    await col(storeId, "logs").add({
      jobId, channel: step.action, status: "failed", error: String(err), at: Date.now(),
    });
    return { ok: true, status: "failed", reason: String(err) };
  }
}
