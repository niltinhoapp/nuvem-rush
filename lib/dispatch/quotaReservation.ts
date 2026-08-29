import { FieldValue } from "firebase-admin/firestore";
import type { Job, Store } from "@/types";

export type QuotaChannel = "dispatches" | "whatsapp";

type Quotas = Store["quotas"];

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function quotaChannelForJob(job: Pick<Job, "channel">): QuotaChannel {
  return job.channel === "whatsapp" ? "whatsapp" : "dispatches";
}

export function quotaFields(channel: QuotaChannel) {
  return channel === "whatsapp"
    ? {
      used: "quotas.whatsappMonthUsed",
      reserved: "quotas.whatsappMonthReserved",
      limit: "quotas.whatsappMonthLimit",
    }
    : {
      used: "quotas.dispatchesMonthUsed",
      reserved: "quotas.dispatchesMonthReserved",
      limit: "quotas.dispatchesMonthLimit",
    };
}

export function totalReserved(quotas: Partial<Quotas> | undefined): number {
  return numberOrZero(quotas?.dispatchesMonthReserved)
    + numberOrZero(quotas?.whatsappMonthReserved);
}

export function currentPeriodKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function buildQuotaReservation(
  store: Store,
  job: Pick<Job, "channel">,
  now: number,
):
  | { ok: true; periodKey: string; channel: QuotaChannel; storePatch: Record<string, number | string> }
  | { ok: false; reason: "quota_exhausted" | "period_rollover_waiting_for_reservations" } {
  const quotas = store.quotas ?? ({} as Quotas);
  const periodKey = currentPeriodKey(now);
  const channel = quotaChannelForJob(job);
  const fields = quotaFields(channel);
  const storedPeriod = typeof quotas.periodKey === "string" ? quotas.periodKey : undefined;

  // Uma reserva de periodo anterior ainda pode ser finalizada ou liberada.
  // Nunca zeramos seus contadores no meio dessa operacao: esperamos o worker
  // concluir/expirar e recuperar o job antes de iniciar o novo periodo.
  if (storedPeriod && storedPeriod !== periodKey && totalReserved(quotas) > 0) {
    return { ok: false, reason: "period_rollover_waiting_for_reservations" };
  }

  const reset = storedPeriod !== periodKey;
  const dispatchesUsed = reset ? 0 : numberOrZero(quotas.dispatchesMonthUsed);
  const whatsappUsed = reset ? 0 : numberOrZero(quotas.whatsappMonthUsed);
  const dispatchesReserved = reset ? 0 : numberOrZero(quotas.dispatchesMonthReserved);
  const whatsappReserved = reset ? 0 : numberOrZero(quotas.whatsappMonthReserved);
  const used = channel === "whatsapp" ? whatsappUsed : dispatchesUsed;
  const reserved = channel === "whatsapp" ? whatsappReserved : dispatchesReserved;
  const limit = numberOrZero((quotas as Record<string, unknown>)[fields.limit.slice("quotas.".length)]);

  if (used + reserved >= limit) return { ok: false, reason: "quota_exhausted" };

  return {
    ok: true,
    periodKey,
    channel,
    storePatch: {
      "quotas.periodKey": periodKey,
      "quotas.dispatchesMonthUsed": dispatchesUsed,
      "quotas.whatsappMonthUsed": whatsappUsed,
      "quotas.dispatchesMonthReserved": dispatchesReserved + (channel === "dispatches" ? 1 : 0),
      "quotas.whatsappMonthReserved": whatsappReserved + (channel === "whatsapp" ? 1 : 0),
    },
  };
}

export function hasMatchingQuotaReservation(
  store: Store | undefined,
  job: Job | undefined,
  reservationId: string,
): boolean {
  if (!store || !job || job.status !== "processing") return false;
  if (job.quotaReservationId !== reservationId) return false;
  return job.quotaReservationPeriodKey === store.quotas?.periodKey;
}

export function buildQuotaRelease(
  store: Store,
  job: Job,
  reservationId?: string,
): Record<string, number> | null {
  if (job.status !== "processing" || typeof job.quotaReservationId !== "string") return {};
  if (reservationId && job.quotaReservationId !== reservationId) return null;
  if (job.quotaReservationPeriodKey !== store.quotas?.periodKey) return null;

  const channel = quotaChannelForJob(job);
  const fields = quotaFields(channel);
  const key = fields.reserved.slice("quotas.".length);
  const reserved = numberOrZero((store.quotas as Record<string, unknown>)[key]);
  if (reserved < 1) return null;
  return { [fields.reserved]: reserved - 1 };
}

export function buildQuotaSuccess(
  store: Store,
  job: Job,
  reservationId: string,
): Record<string, number> | null {
  if (!hasMatchingQuotaReservation(store, job, reservationId)) return null;
  const channel = quotaChannelForJob(job);
  const fields = quotaFields(channel);
  const quotas = store.quotas as Record<string, unknown>;
  const used = numberOrZero(quotas[fields.used.slice("quotas.".length)]);
  const reserved = numberOrZero(quotas[fields.reserved.slice("quotas.".length)]);
  const limit = numberOrZero(quotas[fields.limit.slice("quotas.".length)]);
  if (reserved < 1 || used >= limit) return null;
  return {
    [fields.used]: used + 1,
    [fields.reserved]: reserved - 1,
  };
}

export function clearQuotaReservation() {
  return {
    quotaReservationId: FieldValue.delete(),
    quotaReservationPeriodKey: FieldValue.delete(),
    quotaReservedAt: FieldValue.delete(),
  };
}

// Harness deterministico para os testes de concorrencia. A secao critica e
// propositalmente sincrona, espelhando a transacao Firestore que protege o
// mesmo read-check-write no runtime.
export function createInMemoryQuotaLedger(initial: {
  used: number;
  reserved: number;
  limit: number;
  periodKey: string;
}) {
  const state = { ...initial };
  const reservations = new Map<string, string>();
  return {
    state,
    async claim(reservationId: string, periodKey: string): Promise<boolean> {
      if (state.periodKey !== periodKey && state.reserved > 0) return false;
      if (state.periodKey !== periodKey) {
        state.periodKey = periodKey;
        state.used = 0;
        state.reserved = 0;
      }
      if (state.used + state.reserved >= state.limit) return false;
      state.reserved++;
      reservations.set(reservationId, state.periodKey);
      return true;
    },
    async release(reservationId: string): Promise<boolean> {
      if (reservations.get(reservationId) !== state.periodKey || state.reserved < 1) return false;
      reservations.delete(reservationId);
      state.reserved--;
      return true;
    },
    async finalize(reservationId: string): Promise<boolean> {
      if (
        reservations.get(reservationId) !== state.periodKey
        || state.reserved < 1
        || state.used >= state.limit
      ) return false;
      reservations.delete(reservationId);
      state.reserved--;
      state.used++;
      return true;
    },
  };
}
