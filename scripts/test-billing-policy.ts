import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMERCIAL_CACHE_TTL_MS,
  isCommercialAccessGranted,
  resolveStoreCommercialState,
} from "../lib/billing/policy";

function main() {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);

  // Cache nunca sincronizada -> billing_unknown, mesmo se billingBlocked
  // estiver ausente (nunca herda acesso as cegas).
  assert.equal(resolveStoreCommercialState({}, now), "billing_unknown");
  assert.equal(isCommercialAccessGranted(resolveStoreCommercialState({}, now)), false);

  // Cache dentro do TTL, sem bloqueio -> paid_active.
  assert.equal(
    resolveStoreCommercialState({ billingBlocked: false, commercialSyncedAt: now - 1000 }, now),
    "paid_active",
  );
  assert.equal(
    resolveStoreCommercialState({ commercialSyncedAt: now - 1000 }, now), // billingBlocked ausente = nao bloqueado
    "paid_active",
  );
  // Cache dentro do TTL, bloqueada -> paid_inactive.
  assert.equal(
    resolveStoreCommercialState({ billingBlocked: true, commercialSyncedAt: now - 1000 }, now),
    "paid_inactive",
  );

  // Cache exatamente no limite do TTL (nao passou) ainda e valida.
  assert.equal(
    resolveStoreCommercialState({ billingBlocked: false, commercialSyncedAt: now - COMMERCIAL_CACHE_TTL_MS }, now),
    "paid_active",
  );
  // Cache passou do TTL -> billing_unknown, mesmo com billingBlocked=false
  // persistido (staleness nunca concede acesso as cegas).
  assert.equal(
    resolveStoreCommercialState(
      { billingBlocked: false, commercialSyncedAt: now - COMMERCIAL_CACHE_TTL_MS - 1 },
      now,
    ),
    "billing_unknown",
  );
  // commercialSyncedAt invalido (NaN/Infinity) e tratado como ausente.
  assert.equal(
    resolveStoreCommercialState({ billingBlocked: false, commercialSyncedAt: Number.NaN }, now),
    "billing_unknown",
  );
  assert.equal(
    resolveStoreCommercialState({ billingBlocked: false, commercialSyncedAt: Number.POSITIVE_INFINITY }, now),
    "billing_unknown",
  );
  assert.equal(resolveStoreCommercialState({ billingBlocked: false, commercialSyncedAt: now }, Number.NaN), "billing_unknown");

  assert.equal(isCommercialAccessGranted("paid_active"), true);
  assert.equal(isCommercialAccessGranted("paid_inactive"), false);
  assert.equal(isCommercialAccessGranted("billing_unknown"), false);

  assert.equal(COMMERCIAL_CACHE_TTL_MS, 26 * 60 * 60 * 1000);

  // Relogio do cliente nao entra na formula: so aceita `now` do chamador
  // (server-side) — sem leitura de Date.now() do browser aqui.
  const source = readFileSync(new URL("../lib/billing/policy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.|document\./);
  // O contrato antigo (subscriptions GET por store, trial local perpetuo)
  // nao pode voltar por acidente: nenhum destes SIMBOLOS (nao a mencao
  // historica em comentario) deve existir mais.
  assert.doesNotMatch(source, /"trial_active"|"trial_expired"|TRIAL_DURATION_MS/);

  const dispatch = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  const process = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
  const whatsappTest = readFileSync(new URL("../lib/whatsapp/testRateLimit.firestore.ts", import.meta.url), "utf8");
  assert.match(dispatch, /commercialAccess/);
  assert.match(dispatch, /resolveStoreCommercialState/);
  assert.match(process, /resolveStoreCommercialState/);
  assert.match(whatsappTest, /resolveStoreCommercialState/);
  assert.match(whatsappTest, /commercial_inactive/);

  // Blocker 2 (redact): nenhum modulo de billing deve mais referenciar um
  // ledger/fallback local persistente de trial.
  const accessSignal = readFileSync(new URL("../lib/billing/accessSignal.firestore.ts", import.meta.url), "utf8");
  assert.doesNotMatch(accessSignal, /commercial_trial_fallback|trialFallback/);

  console.log("Billing policy: OK");
}

main();
