// Logica de disparo de um job (revalida, envia pelo canal, registra log).
// Reutilizada pelo cron da Vercel e pelo endpoint /api/dispatch.
import { col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsapp } from "@/lib/channels/whatsapp";
import type { Job, Flow, Store } from "@/types";

export type DispatchResult =
  | { ok: true; status: "sent" | "cancelled" | "skipped" | "failed"; reason?: string };

export async function dispatchJob(storeId: string, jobId: string): Promise<DispatchResult> {
  const jobRef = col(storeId, "jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return { ok: true, status: "skipped", reason: "job inexistente" };

  const job = jobSnap.data() as Job;
  if (job.status !== "scheduled") return { ok: true, status: "skipped", reason: "ja processado" };

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
  if (quotaUsed >= quotaLimit) {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "quota do canal esgotada" };
  }

  try {
    if (step.action === "email") {
      await sendEmail({ storeId, enrollmentId: job.enrollmentId, step });
    } else if (step.action === "whatsapp") {
      await sendWhatsapp({ storeId, enrollmentId: job.enrollmentId, step });
    }
    // TODO: tag, webhook, task.

    await jobRef.update({ status: "sent" });
    await storeRef(storeId).update(
      isWhatsapp
        ? { "quotas.whatsappMonthUsed": (store.quotas.whatsappMonthUsed ?? 0) + 1 }
        : { "quotas.dispatchesMonthUsed": store.quotas.dispatchesMonthUsed + 1 },
    );
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
