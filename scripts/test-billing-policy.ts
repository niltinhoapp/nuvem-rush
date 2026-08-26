import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRIAL_DURATION_MS,
  isCommercialAccessGranted,
  resolveCommercialState,
  trialDaysRemaining,
} from "../lib/billing/policy";

function main() {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);

  // Trial nunca iniciado (loja legada/inexistente): expirado, nunca ativo.
  assert.equal(resolveCommercialState({}, now), "trial_expired");
  assert.equal(isCommercialAccessGranted(resolveCommercialState({}, now)), false);

  // Trial dentro da janela de 14 dias.
  assert.equal(
    resolveCommercialState({ trialEndsAt: now + 1 }, now),
    "trial_active",
  );
  // No instante exato do fim: now < trialEndsAt e falso -> expirado (limite
  // exclusivo, sem ambiguidade de "ultimo segundo ainda vale").
  assert.equal(resolveCommercialState({ trialEndsAt: now }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: now - 1 }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: Number.NaN }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: Number.POSITIVE_INFINITY }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: now + 1 }, Number.NaN), "trial_expired");

  // Assinatura ativa sempre vence, mesmo sem trial ou com trial ja vencido.
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "active" }, now),
    "paid_active",
  );
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "active", trialEndsAt: now - 1 }, now),
    "paid_active",
  );

  // Assinatura ativa vence mesmo com trial ainda tecnicamente valido.
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "active", trialEndsAt: now + 1 }, now),
    "paid_active",
  );

  // Assinatura cancelada + trial ja consumido/vencido -> inativo, NUNCA volta
  // a trial_active (nao ha reset por cancelamento).
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "inactive", trialEndsAt: now - 1 }, now),
    "paid_inactive",
  );

  // Assinatura cancelada mas trial ainda dentro da janela -> trial prevalece
  // (concede acesso pelo caminho mais permissivo disponivel).
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "inactive", trialEndsAt: now + 1 }, now),
    "trial_active",
  );

  // isCommercialAccessGranted: so os dois estados "ativos" concedem acesso.
  assert.equal(isCommercialAccessGranted("trial_active"), true);
  assert.equal(isCommercialAccessGranted("paid_active"), true);
  assert.equal(isCommercialAccessGranted("trial_expired"), false);
  assert.equal(isCommercialAccessGranted("paid_inactive"), false);

  // Duracao do trial e exatamente 14 dias em ms.
  assert.equal(TRIAL_DURATION_MS, 14 * 24 * 60 * 60 * 1000);

  // trialDaysRemaining: arredonda para cima, nunca negativo, zero se ausente.
  assert.equal(trialDaysRemaining(undefined, now), 0);
  assert.equal(trialDaysRemaining(now - 1, now), 0);
  assert.equal(trialDaysRemaining(now + 24 * 60 * 60 * 1000, now), 1);
  assert.equal(trialDaysRemaining(now + 24 * 60 * 60 * 1000 + 1, now), 2);
  assert.equal(trialDaysRemaining(now + TRIAL_DURATION_MS, now), 14);
  assert.equal(trialDaysRemaining(Number.POSITIVE_INFINITY, now), 0);
  assert.equal(trialDaysRemaining(now + 1, Number.NaN), 0);

  // Relogio do cliente nao entra na formula: a funcao so aceita `now` do
  // chamador (server-side) e trialEndsAt persistido — nao ha leitura de
  // Date.now() do browser em lugar nenhum deste modulo.
  const source = readFileSync(new URL("../lib/billing/policy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.|document\./);
  const dispatch = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  const process = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
  const whatsappTest = readFileSync(new URL("../lib/whatsapp/testRateLimit.firestore.ts", import.meta.url), "utf8");
  assert.match(dispatch, /commercialAccess/);
  assert.match(process, /resolveCommercialState/);
  assert.match(whatsappTest, /commercial_inactive/);

  console.log("Billing policy: OK");
}

main();
