// Logica de disparo de um job (revalida, envia pelo canal, registra log).
// Reutilizada pelo cron da Vercel e pelo endpoint /api/dispatch.
import { col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
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

  // Loja ativa e dentro da quota?
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active" ||
      store.quotas.dispatchesMonthUsed >= store.quotas.dispatchesMonthLimit) {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "quota ou loja inativa" };
  }

  const flow = (await col(storeId, "flows").doc(job.flowId).get()).data() as Flow | undefined;
  const step = flow?.steps[job.stepIndex];
  if (!step) {
    await jobRef.update({ status: "cancelled" });
    return { ok: true, status: "cancelled", reason: "step inexistente" };
  }

  try {
    if (step.action === "email") {
      await sendEmail({ storeId, enrollmentId: job.enrollmentId, step });
    }
    // TODO: whatsapp, tag, webhook, task.

    await jobRef.update({ status: "sent" });
    await storeRef(storeId).update({
      "quotas.dispatchesMonthUsed": store.quotas.dispatchesMonthUsed + 1,
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
