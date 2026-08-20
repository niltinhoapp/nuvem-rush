export type FinalCommercialState = {
  storeActive: boolean;
  jobProcessing: boolean;
};

export type GuardedEffectResult =
  | { status: "blocked"; state: FinalCommercialState }
  | { status: "sent" }
  | { status: "guard_failed"; error: unknown }
  | { status: "effect_failed"; error: unknown };

/**
 * Revalida store/job e inicia o efeito sem nenhum await entre a decisao e a
 * chamada do provider. Isso fecha a janela assíncrona que existia entre a
 * validacao pre-send e sendEmail/sendWhatsapp.
 */
export async function runWithFinalCommercialGuard(
  inspect: () => Promise<FinalCommercialState>,
  effect: () => Promise<void>,
): Promise<GuardedEffectResult> {
  let state: FinalCommercialState;
  try {
    state = await inspect();
  } catch (error) {
    return { status: "guard_failed", error };
  }

  if (!state.storeActive || !state.jobProcessing) {
    return { status: "blocked", state };
  }

  try {
    // Intencionalmente sem await/operacao assincrona entre o if e a chamada.
    await effect();
    return { status: "sent" };
  } catch (error) {
    return { status: "effect_failed", error };
  }
}
