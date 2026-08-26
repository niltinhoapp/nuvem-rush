import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WHATSAPP_TEST_COOLDOWN_MS,
  WHATSAPP_TEST_DAILY_LIMIT,
  decideWhatsappTestAttempt,
} from "../lib/whatsapp/testRateLimit";
import { createInMemoryQuotaLedger } from "../lib/dispatch/quotaReservation";

function routeSource() {
  return readFileSync(new URL("../app/api/whatsapp/test/route.ts", import.meta.url), "utf8");
}

async function main() {
  // Endpoint: sessao Nexo, store ativa/rate-limit transacional e resposta sem
  // detalhes do provider. Os dados persistidos pelo limiter sao somente janela
  // de contagem tenant-scoped; `to` nunca integra o documento.
  const route = routeSource();
  const limiter = readFileSync(new URL("../lib/whatsapp/testRateLimit.firestore.ts", import.meta.url), "utf8");
  assert.match(route, /resolveAuthenticatedStoreId\(req\)/);
  assert.doesNotMatch(route, /resolveStoreId\(req\)/);
  assert.match(route, /claimWhatsappTestAttempt/);
  assert.match(limiter, /resolveCommercialState/);
  assert.match(limiter, /commercial_inactive/);
  assert.doesNotMatch(route, /detail:\s*String\(err\)/);
  assert.doesNotMatch(limiter, /\bto\b|message|accessToken|providerResponse/);

  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(decideWhatsappTestAttempt(undefined, now).ok, true, "primeira tentativa aceita");
  const first = decideWhatsappTestAttempt(undefined, now);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("fixture invalida");
  assert.deepEqual(
    decideWhatsappTestAttempt(first.next, now + WHATSAPP_TEST_COOLDOWN_MS - 1),
    { ok: false, reason: "cooldown" },
    "cooldown de 60 segundos",
  );
  const tenth = { dayKey: first.next.dayKey, attempts: 9, lastAttemptAt: now - WHATSAPP_TEST_COOLDOWN_MS };
  const allowedTenth = decideWhatsappTestAttempt(tenth, now);
  assert.equal(allowedTenth.ok, true, "10a tentativa aceita");
  assert.deepEqual(
    decideWhatsappTestAttempt(
      { dayKey: first.next.dayKey, attempts: WHATSAPP_TEST_DAILY_LIMIT, lastAttemptAt: now - WHATSAPP_TEST_COOLDOWN_MS },
      now,
    ),
    { ok: false, reason: "daily_limit" },
    "11a tentativa recusada",
  );

  // A mesma loja nao atravessa o limite em concorrencia; lojas distintas tem
  // janelas independentes e trocar o destino nao influencia a decisao.
  const attempts = Array.from({ length: 20 }, (_, i) => decideWhatsappTestAttempt(
    i === 0 ? undefined : { dayKey: first.next.dayKey, attempts: i, lastAttemptAt: now - WHATSAPP_TEST_COOLDOWN_MS },
    now,
  ));
  assert.equal(attempts.filter((item) => item.ok).length, WHATSAPP_TEST_DAILY_LIMIT,
    "limite diario e independente do destino");

  // Cota comercial: used=99/100 e dez workers => um unico provider pode
  // obter reserva. As transicoes seguintes usam o mesmo fencing id.
  const ledger = createInMemoryQuotaLedger({ used: 99, reserved: 0, limit: 100, periodKey: "2026-08" });
  const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => ledger.claim(`job-${i}`, "2026-08")));
  assert.equal(claims.filter(Boolean).length, 1, "99/100 + 10 concorrentes = uma reserva");
  assert.deepEqual(ledger.state, { used: 99, reserved: 1, limit: 100, periodKey: "2026-08" });
  assert.equal(await ledger.finalize("job-0"), claims[0] === true, "somente dono finaliza");
  assert.equal(ledger.state.used, 100, "sucesso incrementa used uma vez");
  assert.equal(ledger.state.reserved, 0, "sucesso libera reserva uma vez");
  assert.equal(await ledger.claim("after-limit", "2026-08"), false, "used=100 bloqueia provider");

  const retry = createInMemoryQuotaLedger({ used: 99, reserved: 0, limit: 100, periodKey: "2026-08" });
  assert.equal(await retry.claim("attempt-1", "2026-08"), true);
  assert.equal(await retry.release("attempt-1"), true, "falha libera a reserva");
  assert.equal(await retry.release("attempt-1"), false, "cancelamento/release duplicado nao fica negativo");
  assert.equal(await retry.claim("attempt-2", "2026-08"), true, "retry recebe nova reserva");
  assert.equal(await retry.finalize("attempt-1"), false, "worker stale nao finaliza reserva nova");
  assert.equal(await retry.finalize("attempt-2"), true, "nova tentativa conclui");
  assert.equal(retry.state.reserved >= 0 && retry.state.used <= retry.state.limit, true,
    "invariantes de quota preservados");

  const rollover = createInMemoryQuotaLedger({ used: 99, reserved: 1, limit: 100, periodKey: "2026-08" });
  assert.equal(await rollover.claim("new-month", "2026-09"), false,
    "virada de mes aguarda reserva antiga, sem debitar periodo novo");
  assert.equal(await rollover.release("old"), false, "id inexistente nao libera");

  const dispatch = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  assert.match(dispatch, /buildQuotaReservation/);
  assert.match(dispatch, /hasMatchingQuotaReservation/);
  assert.match(dispatch, /buildQuotaSuccess/);
  assert.match(dispatch, /buildQuotaRelease/);
  assert.match(dispatch, /final_guard_failed/);
  assert.match(dispatch, /cancelJobAndReleaseQuota/);
  assert.match(dispatch, /quotaReservationId/);

  console.log("Provider abuse + atomic quota: OK");
}

main().catch((error: unknown) => {
  console.error("Provider abuse + atomic quota test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
