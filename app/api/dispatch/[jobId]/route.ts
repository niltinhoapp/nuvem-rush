// Endpoint chamado pelo Cloud Tasks no horario agendado.
// Revalida o job, renderiza o conteudo e envia pelo canal correto.
import { NextRequest, NextResponse } from "next/server";
import { col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
import type { Job, Flow, Store } from "@/types";

export async function POST(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;

  // So aceita chamadas do nosso Cloud Tasks (segredo compartilhado).
  if (req.headers.get("x-dispatch-secret") !== process.env.INTERNAL_DISPATCH_SECRET) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId ausente" }, { status: 400 });

  const jobRef = col(storeId, "jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return NextResponse.json({ ok: true }); // idempotente
  const job = jobSnap.data() as Job;
  if (job.status !== "scheduled") return NextResponse.json({ ok: true });

  // Revalidacoes: enrollment ativo? quota disponivel?
  const enroll = await col(storeId, "enrollments").doc(job.enrollmentId).get();
  if (!enroll.exists || enroll.data()!.status !== "active") {
    await jobRef.update({ status: "cancelled" });
    return NextResponse.json({ ok: true });
  }

  const store = (await storeRef(storeId).get()).data() as Store;
  if (store.status !== "active" ||
      store.quotas.dispatchesMonthUsed >= store.quotas.dispatchesMonthLimit) {
    await jobRef.update({ status: "cancelled" });
    return NextResponse.json({ ok: true, reason: "quota_or_inactive" });
  }

  const flow = (await col(storeId, "flows").doc(job.flowId).get()).data() as Flow;
  const step = flow.steps[job.stepIndex]!;

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
  } catch (err) {
    await jobRef.update({ status: "failed" });
    await col(storeId, "logs").add({
      jobId, channel: step.action, status: "failed",
      error: String(err), at: Date.now(),
    });
  }

  return NextResponse.json({ ok: true });
}
