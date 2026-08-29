// Logica de disparo de um job (revalida, envia pelo canal, registra log).
// Reutilizada pelo cron da Vercel e pelo endpoint /api/dispatch.
import { randomUUID } from "node:crypto";
import { db, col, storeRef } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/channels/email";
import { sendWhatsapp } from "@/lib/channels/whatsapp";
import { applyTag } from "@/lib/channels/tag";
import { triggerWebhook } from "@/lib/channels/webhook";
import { canClaim, isOrphanProcessing } from "@/lib/dispatch/claim";
import { planRetry, MAX_ATTEMPTS } from "@/lib/dispatch/retry";
import type { Job, Flow, Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { isCommercialAccessGranted, resolveStoreCommercialState } from "@/lib/billing/policy";
import { ensureFreshCommercialAccess } from "@/lib/billing/accessSignal.firestore";
import { runWithFinalCommercialGuard } from "@/lib/dispatch/finalGuard";
import { cancelJobAndReleaseQuota } from "@/lib/dispatch/cancel";
import {
  buildQuotaRelease,
  buildQuotaReservation,
  buildQuotaSuccess,
  clearQuotaReservation,
  hasMatchingQuotaReservation,
} from "@/lib/dispatch/quotaReservation";

export type DispatchResult =
  | { ok: true; status: "sent" | "cancelled" | "skipped" | "failed"; reason?: string };

export type DispatchClaim =
  | { ok: true; job: Job; reservationId: string }
  | { ok: false; reason: string };

export type DispatchFinalization =
  | { ok: true }
  | {
    ok: false;
    storeActive: boolean;
    jobStatus: string | undefined;
    enrollmentActive: boolean;
  };

export async function claimJobForDispatch(
  storeId: string,
  jobId: string,
  now: number = Date.now(),
  reservationIdFactory: () => string = randomUUID,
): Promise<DispatchClaim> {
  const jobRef = col(storeId, "jobs").doc(jobId);
  // Claim + RESERVA de cota numa unica transacao. Nenhum provider e chamado
  // sem uma reserva identificada no job, portanto used + reserved nunca passa
  // do limite mesmo quando varios workers chegam juntos.
  const claim = await db.runTransaction(async (tx) => {
    const storeSnap = await tx.get(storeRef(storeId));
    const snap = await tx.get(jobRef);
    if (!snap.exists) return { ok: false as const, reason: "job inexistente" };
    const j = snap.data() as Job;
    if (!isStoreCommerciallyActive(storeSnap.data()?.status)) {
      if (j.status === "scheduled") {
        tx.update(jobRef, { status: "cancelled", cancelReason: "store_inactive" });
      }
      return { ok: false as const, reason: "loja inativa" };
    }
    // Gate comercial (Billing V1): a Nuvemshop bloqueando o acesso desta loja
    // (ou o estado sendo desconhecido) bloqueia o provider aqui, no mesmo
    // ponto que ja bloqueia loja inativa — nao depende da UI. Cancelamento
    // terminal (nao agenda retry): um bloqueio comercial nao deve gerar
    // tempestade de retries.
    const commercial = resolveStoreCommercialState(storeSnap.data() as Store, now);
    if (!isCommercialAccessGranted(commercial)) {
      if (j.status === "scheduled") {
        tx.update(jobRef, { status: "cancelled", cancelReason: "commercial_inactive" });
      }
      return { ok: false as const, reason: "acesso comercial bloqueado" };
    }
    if (!canClaim(j.status)) return { ok: false as const, reason: "ja processado" };
    const reservation = buildQuotaReservation(storeSnap.data() as Store, j, now);
    if (!reservation.ok) {
      if (reservation.reason === "quota_exhausted") {
        tx.update(jobRef, { status: "cancelled", cancelReason: "quota do canal esgotada" });
      }
      return { ok: false as const, reason: reservation.reason };
    }
    const reservationId = reservationIdFactory();
    tx.update(storeRef(storeId), reservation.storePatch);
    tx.update(jobRef, {
      status: "processing",
      claimedAt: now,
      quotaReservationId: reservationId,
      quotaReservationPeriodKey: reservation.periodKey,
      quotaReservedAt: now,
    });
    return { ok: true as const, job: j, reservationId };
  });
  return claim;
}

export async function finalizeClaimedDispatch(
  storeId: string,
  jobId: string,
  reservationId: string,
): Promise<DispatchFinalization> {
  const jobRef = col(storeId, "jobs").doc(jobId);
  return db.runTransaction(async (tx) => {
    const [finalStore, finalJob] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(jobRef),
    ]);
    const job = finalJob.data() as Job | undefined;
    if (!job) {
      return {
        ok: false as const,
        storeActive: isStoreCommerciallyActive(finalStore.data()?.status),
        jobStatus: undefined,
        enrollmentActive: false,
      };
    }
    const finalEnrollment = await tx.get(col(storeId, "enrollments").doc(job.enrollmentId));
    if (
      !isStoreCommerciallyActive(finalStore.data()?.status)
      || !hasMatchingQuotaReservation(
        finalStore.data() as Store | undefined,
        job,
        reservationId,
      )
      || finalEnrollment?.data()?.status !== "active"
    ) {
      return {
        ok: false as const,
        storeActive: isStoreCommerciallyActive(finalStore.data()?.status),
        jobStatus: job?.status,
        enrollmentActive: finalEnrollment?.data()?.status === "active",
      };
    }
    const quotaPatch = buildQuotaSuccess(
      finalStore.data() as Store,
      job,
      reservationId,
    );
    if (!quotaPatch) {
      return {
        ok: false as const,
        storeActive: true,
        jobStatus: job.status,
        enrollmentActive: true,
      };
    }
    tx.update(jobRef, { status: "sent", ...clearQuotaReservation() });
    tx.update(storeRef(storeId), quotaPatch);
    return { ok: true as const };
  });
}

export async function dispatchJob(
  storeId: string,
  jobId: string,
  // Injetavel so para teste (fake HTTP do probe da guarda final) — nunca
  // chamado com a API real nesta OS.
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchResult> {
  const jobRef = col(storeId, "jobs").doc(jobId);
  const claim = await claimJobForDispatch(storeId, jobId);
  if (!claim.ok) return { ok: true, status: "skipped", reason: claim.reason };
  const job = claim.job;
  const reservationId = claim.reservationId;

  // Revalidacoes: enrollment ativo?
  const enroll = await col(storeId, "enrollments").doc(job.enrollmentId).get();
  if (!enroll.exists || enroll.data()!.status !== "active") {
    await cancelJobAndReleaseQuota({
      storeId, jobRef, reason: "enrollment_inactive", now: Date.now(), expectedStatus: "processing",
    });
    return { ok: true, status: "cancelled", reason: "enrollment inativo" };
  }

  // Loja ativa?
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  if (!store || store.status !== "active") {
    await cancelJobAndReleaseQuota({
      storeId, jobRef, reason: "store_inactive", now: Date.now(), expectedStatus: "processing",
    });
    return { ok: true, status: "cancelled", reason: "loja inativa" };
  }

  const flow = (await col(storeId, "flows").doc(job.flowId).get()).data() as Flow | undefined;

  // Defesa explicita de ciclo de vida do fluxo — nao depende do filtro feito
  // no momento da inscricao: um fluxo pausado/excluido DEPOIS de o job ter
  // sido agendado nao pode disparar.
  if (!flow || flow.deletedAt || flow.status !== "active") {
    await cancelJobAndReleaseQuota({
      storeId,
      jobRef,
      reason: !flow
        ? "flow_inexistente"
        : flow.deletedAt
          ? "flow_deletado"
          : "flow_nao_ativo",
      now: Date.now(),
      expectedStatus: "processing",
    });
    return { ok: true, status: "cancelled", reason: "fluxo inativo/excluido" };
  }

  const step = flow.steps[job.stepIndex];
  if (!step || step.action !== job.channel) {
    await cancelJobAndReleaseQuota({
      storeId, jobRef, reason: "step_inexistente_ou_canal_invalido", now: Date.now(), expectedStatus: "processing",
    });
    return { ok: true, status: "cancelled", reason: "step inexistente" };
  }

  // Guarda FINAL: probe Nuvemshop atual -> RE-LEITURA de store/job/enrollment
  // (fecha a corrida: uninstall/cancelamento/perda de reserva DURANTE o probe
  // nao pode ser ignorado) -> decisao -> provider iniciado sem nenhum await
  // entre a decisao e a chamada externa.
  const delivery = await runWithFinalCommercialGuard(
    async () => {
      // 1) Leitura minima so para obter o accessToken e fazer o probe. O
      // probe e a unica etapa com latencia de rede real (com retry/backoff
      // do proprio NuvemshopClient) — por isso as leituras de lifecycle que
      // IMPORTAM para a decisao final vem DEPOIS dele, nunca antes.
      const preProbeStore = (await storeRef(storeId).get()).data() as Store | undefined;
      const commercialState = preProbeStore?.accessToken
        ? await ensureFreshCommercialAccess(storeId, preProbeStore.accessToken, Date.now(), fetchImpl)
        : "billing_unknown";

      // 2) Re-leitura POS-probe: qualquer uninstall/cancelamento/liberacao de
      // reserva que tenha acontecido durante a espera de rede do probe agora
      // e capturado aqui, imediatamente antes do zero-await ate o provider.
      const [postProbeStore, postProbeJob, postProbeEnrollment] = await Promise.all([
        storeRef(storeId).get(),
        jobRef.get(),
        col(storeId, "enrollments").doc(job.enrollmentId).get(),
      ]);
      const postProbeStoreData = postProbeStore.data() as Store | undefined;
      return {
        storeActive: isStoreCommerciallyActive(postProbeStoreData?.status),
        commercialAccess: isCommercialAccessGranted(commercialState),
        jobProcessing: hasMatchingQuotaReservation(
          postProbeStoreData,
          postProbeJob.data() as Job | undefined,
          reservationId,
        ),
        enrollmentActive: postProbeEnrollment.data()?.status === "active",
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

  if (delivery.status === "guard_failed") {
    // A guarda falhou antes de qualquer provider. Libera a reserva com o
    // fencing do claim e agenda nova leitura; assim uma indisponibilidade
    // transitória do Firestore nao prende capacidade ate o timeout de orfao.
    const released = await db.runTransaction(async (tx) => {
      const [storeSnap, jobSnap] = await Promise.all([
        tx.get(storeRef(storeId)),
        tx.get(jobRef),
      ]);
      const currentStore = storeSnap.data() as Store | undefined;
      const currentJob = jobSnap.data() as Job | undefined;
      if (!currentStore || !currentJob || !hasMatchingQuotaReservation(currentStore, currentJob, reservationId)) {
        return false;
      }
      const release = buildQuotaRelease(currentStore, currentJob, reservationId);
      if (!release) return false;
      tx.update(storeRef(storeId), release);
      tx.update(jobRef, {
        status: "scheduled",
        runAt: Date.now() + 60_000,
        nextAttemptAt: Date.now() + 60_000,
        lastError: "final_guard_failed",
        ...clearQuotaReservation(),
      });
      return true;
    });
    return {
      ok: true,
      status: released ? "failed" : "cancelled",
      reason: released ? "falha na guarda final; reagendado" : "reserva perdida antes da guarda",
    };
  }
  if (delivery.status === "blocked") {
    if (delivery.state.jobProcessing) {
      await cancelJobAndReleaseQuota({
        storeId,
        jobRef,
        reason: !delivery.state.storeActive
          ? "store_inactive"
          : !delivery.state.commercialAccess
            ? "commercial_inactive"
            : "enrollment_inactive",
        now: Date.now(),
        expectedStatus: "processing",
      });
    }
    return {
      ok: true,
      status: "cancelled",
      reason: !delivery.state.storeActive
        ? "loja inativa antes do envio"
        : !delivery.state.commercialAccess
          ? "acesso comercial inativo antes do envio"
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
    const settled = await db.runTransaction(async (tx) => {
      const [storeSnap, jobSnap] = await Promise.all([
        tx.get(storeRef(storeId)),
        tx.get(jobRef),
      ]);
      const currentStore = storeSnap.data() as Store | undefined;
      const currentJob = jobSnap.data() as Job | undefined;
      if (!currentStore || !currentJob || !hasMatchingQuotaReservation(currentStore, currentJob, reservationId)) {
        return false;
      }
      const release = buildQuotaRelease(currentStore, currentJob, reservationId);
      if (!release) return false;
      tx.update(storeRef(storeId), release);
      tx.update(jobRef, {
        ...(plan.retry
          ? {
            status: "scheduled",
            runAt: plan.nextAttemptAt,
            attempts: plan.attempts,
            lastError: String(err),
            nextAttemptAt: plan.nextAttemptAt,
          }
          : { status: "failed", attempts: plan.attempts, lastError: String(err) }),
        ...clearQuotaReservation(),
      });
      return true;
    });
    if (!settled) return { ok: true, status: "cancelled", reason: "reserva perdida antes do retry" };
    if (plan.retry) {
      await col(storeId, "logs").add({
        jobId, channel: step.action, status: "retry",
        attempt: plan.attempts, error: String(err), at: Date.now(),
      });
      return { ok: true, status: "failed", reason: `retry #${plan.attempts}: ${String(err)}` };
    }
    await col(storeId, "logs").add({
      jobId, channel: step.action, status: "failed",
      attempt: plan.attempts, error: String(err), at: Date.now(),
    });
    return { ok: true, status: "failed", reason: String(err) };
  }

  // Finalizacao atomica: se o uninstall ocorreu enquanto o provider estava em
  // andamento, o handler ja cancelou o job e esta transacao NAO pode
  // sobrescrever cancelled com sent nem consumir cota.
  const finalized = await finalizeClaimedDispatch(storeId, jobId, reservationId);
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
      const [storeSnap, s] = await Promise.all([tx.get(storeRef(storeId)), tx.get(d.ref)]);
      if (!s.exists) return false;
      const j = s.data() as Job;
      // Recheca dentro da transacao: se outro cron ja recuperou (status mudou),
      // desiste — sem duplicidade.
      if (!isOrphanProcessing(j.status, j.claimedAt, now)) return false;

      const store = storeSnap.data() as Store | undefined;
      const release = store ? buildQuotaRelease(store, j) : {};
      if (release === null) return false;
      if (Object.keys(release).length > 0) tx.update(storeRef(storeId), release);
      const attempts = (j.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        tx.update(d.ref, {
          status: "failed",
          attempts,
          lastError: "orfao em processing: tentativas esgotadas",
          ...clearQuotaReservation(),
        });
      } else {
        tx.update(d.ref, {
          status: "scheduled",
          runAt: now,
          attempts,
          lastError: "recuperado de processing orfao",
          nextAttemptAt: now,
          ...clearQuotaReservation(),
        });
      }
      return true;
    });
    if (ok) recovered++;
  }
  return recovered;
}
