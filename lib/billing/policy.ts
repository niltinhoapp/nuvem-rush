// Politica comercial central (Billing V1): trial de 14 dias + um unico plano
// pago. PURA e testavel isoladamente — nenhuma rota/worker deve comparar
// Date.now() contra trialEndsAt por conta propria; todos usam
// resolveCommercialState() para nunca divergir.
//
// Fonte de tempo: SEMPRE o `now` passado pelo chamador (server-side,
// tipicamente Date.now() do backend ou o timestamp de uma transacao
// Firestore) — nunca um valor vindo do cliente/browser.

export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export type CommercialState =
  | "trial_active"
  | "trial_expired"
  | "paid_active"
  | "paid_inactive";

export interface CommercialInput {
  trialEndsAt?: number;
  subscriptionStatus?: "active" | "inactive";
}

// Assinatura ativa sempre concede acesso, independente do trial (mesmo um
// trial nunca iniciado/expirado). Sem assinatura ativa, o acesso depende
// exclusivamente do trial ainda nao ter vencido. Uma vez expirado, nao ha
// caminho de volta a trial_active — so uma assinatura paga muda o estado.
export function resolveCommercialState(input: CommercialInput, now: number): CommercialState {
  if (input.subscriptionStatus === "active") return "paid_active";
  if (
    Number.isFinite(now)
    && typeof input.trialEndsAt === "number"
    && Number.isFinite(input.trialEndsAt)
    && now < input.trialEndsAt
  ) return "trial_active";
  if (input.subscriptionStatus === "inactive") return "paid_inactive";
  return "trial_expired";
}

export function isCommercialAccessGranted(state: CommercialState): boolean {
  return state === "trial_active" || state === "paid_active";
}

export function trialDaysRemaining(trialEndsAt: number | undefined, now: number): number {
  if (!Number.isFinite(now) || typeof trialEndsAt !== "number" || !Number.isFinite(trialEndsAt)) return 0;
  return Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)));
}
