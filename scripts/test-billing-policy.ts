import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRIAL_DURATION_MS,
  COMMERCIAL_CACHE_TTL_MS,
  isCommercialAccessGranted,
  resolveCommercialState,
  resolveStoreCommercialState,
  resolveCommercialStateFromBilling,
  trialDaysRemaining,
} from "../lib/billing/policy";

function main() {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);

  // --- resolveCommercialState (camada pura, le so o input ja resolvido) ---
  assert.equal(resolveCommercialState({}, now), "trial_expired");
  assert.equal(isCommercialAccessGranted(resolveCommercialState({}, now)), false);
  assert.equal(resolveCommercialState({ trialEndsAt: now + 1 }, now), "trial_active");
  assert.equal(resolveCommercialState({ trialEndsAt: now }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: now - 1 }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: Number.NaN }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: Number.POSITIVE_INFINITY }, now), "trial_expired");
  assert.equal(resolveCommercialState({ trialEndsAt: now + 1 }, Number.NaN), "trial_expired");
  assert.equal(resolveCommercialState({ subscriptionStatus: "active" }, now), "paid_active");
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "active", trialEndsAt: now - 1 }, now),
    "paid_active",
  );
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "active", trialEndsAt: now + 1 }, now),
    "paid_active",
  );
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "inactive", trialEndsAt: now - 1 }, now),
    "paid_inactive",
  );
  assert.equal(
    resolveCommercialState({ subscriptionStatus: "inactive", trialEndsAt: now + 1 }, now),
    "trial_active",
  );
  assert.equal(isCommercialAccessGranted("trial_active"), true);
  assert.equal(isCommercialAccessGranted("paid_active"), true);
  assert.equal(isCommercialAccessGranted("trial_expired"), false);
  assert.equal(isCommercialAccessGranted("paid_inactive"), false);
  assert.equal(isCommercialAccessGranted("billing_unknown"), false);

  assert.equal(TRIAL_DURATION_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(COMMERCIAL_CACHE_TTL_MS, 26 * 60 * 60 * 1000);

  assert.equal(trialDaysRemaining(undefined, now), 0);
  assert.equal(trialDaysRemaining(now - 1, now), 0);
  assert.equal(trialDaysRemaining(now + 24 * 60 * 60 * 1000, now), 1);
  assert.equal(trialDaysRemaining(now + 24 * 60 * 60 * 1000 + 1, now), 2);
  assert.equal(trialDaysRemaining(now + TRIAL_DURATION_MS, now), 14);
  assert.equal(trialDaysRemaining(Number.POSITIVE_INFINITY, now), 0);
  assert.equal(trialDaysRemaining(now + 1, Number.NaN), 0);

  // --- resolveStoreCommercialState (gate-facing, TTL-aware) ---
  // Cache nunca sincronizada -> billing_unknown, mesmo com subscriptionStatus
  // "active" no doc (nunca herda paid_active as cegas de uma cache que nunca rodou).
  assert.equal(
    resolveStoreCommercialState({ subscriptionStatus: "active" }, now),
    "billing_unknown",
  );
  // Cache nunca sincronizada mas com trial local ainda genuinamente valido ->
  // trial_active (nao pune quem instalou e o primeiro sync ainda nao rodou).
  assert.equal(
    resolveStoreCommercialState({ trialEndsAt: now + 1 }, now),
    "trial_active",
  );
  // Cache dentro do TTL -> delega para resolveCommercialState normalmente.
  assert.equal(
    resolveStoreCommercialState({ subscriptionStatus: "active", commercialSyncedAt: now - 1000 }, now),
    "paid_active",
  );
  // Cache exatamente no limite do TTL (nao passou) ainda e valida.
  assert.equal(
    resolveStoreCommercialState(
      { subscriptionStatus: "active", commercialSyncedAt: now - COMMERCIAL_CACHE_TTL_MS },
      now,
    ),
    "paid_active",
  );
  // Cache passou do TTL -> billing_unknown, mesmo com subscriptionStatus "active"
  // persistido (staleness nunca concede acesso as cegas).
  assert.equal(
    resolveStoreCommercialState(
      { subscriptionStatus: "active", commercialSyncedAt: now - COMMERCIAL_CACHE_TTL_MS - 1 },
      now,
    ),
    "billing_unknown",
  );
  // Cache velha demais mas com trial local ainda valido -> ainda cai para
  // trial_active (mesmo raciocinio da cache nunca sincronizada).
  assert.equal(
    resolveStoreCommercialState(
      { trialEndsAt: now + 1, commercialSyncedAt: now - COMMERCIAL_CACHE_TTL_MS - 1 },
      now,
    ),
    "trial_active",
  );
  // commercialSyncedAt invalido (NaN) e tratado como ausente -> mesmo caminho.
  assert.equal(
    resolveStoreCommercialState({ subscriptionStatus: "active", commercialSyncedAt: Number.NaN }, now),
    "billing_unknown",
  );

  // --- resolveCommercialStateFromBilling (so usada pelo sync) ---
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "unknown" }, false, {}, now),
    "billing_unknown",
  );
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "found" }, false, {}, now),
    "paid_active",
  );
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "found" }, true, {}, now),
    "paid_inactive",
  );
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "not_found" }, false, { trialEndsAt: now + 1 }, now),
    "trial_active",
  );
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "not_found" }, false, { trialEndsAt: now - 1 }, now),
    "trial_expired",
  );
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "not_found" }, false, {}, now),
    "trial_expired",
  );
  // `suspended` so importa quando ha assinatura encontrada; sem assinatura,
  // a suspensao (sinal que so existe para quem tem assinatura) e ignorada.
  assert.equal(
    resolveCommercialStateFromBilling({ kind: "not_found" }, true, { trialEndsAt: now + 1 }, now),
    "trial_active",
  );

  // Relogio do cliente nao entra na formula: as funcoes so aceitam `now` do
  // chamador (server-side) — sem leitura de Date.now() do browser aqui.
  const source = readFileSync(new URL("../lib/billing/policy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.|document\./);
  const dispatch = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  const process = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
  const whatsappTest = readFileSync(new URL("../lib/whatsapp/testRateLimit.firestore.ts", import.meta.url), "utf8");
  assert.match(dispatch, /commercialAccess/);
  assert.match(process, /resolveStoreCommercialState/);
  assert.match(whatsappTest, /commercial_inactive/);
  // Todos os gates usam a variante TTL-aware, nunca a pura direto no doc cru.
  assert.match(dispatch, /resolveStoreCommercialState/);
  assert.match(whatsappTest, /resolveStoreCommercialState/);

  console.log("Billing policy: OK");
}

main();
