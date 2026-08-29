// Teste do gate de agendamento do cron (Fase F / opcao A: cron a cada 5 min).
// Cobre os 5 cenarios exigidos, usando os helpers reais do dispatch.
import { isJobDue, canClaim, createInMemoryJobStore } from "../lib/dispatch/claim";
import { planRetry } from "../lib/dispatch/retry";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  const now = 1_000_000;

  // 1) Job FUTURO nao executa (runAt > now).
  check("job futuro (runAt > now) NAO e vencido", isJobDue(now + 5 * 60_000, now) === false);

  // 2) Job VENCIDO executa (runAt <= now), inclusive exatamente agora.
  check("job vencido (runAt < now) e vencido", isJobDue(now - 1, now) === true);
  check("job no limite (runAt == now) e vencido", isJobDue(now, now) === true);

  // 3) Duas chamadas concorrentes NAO duplicam envio (claim atomico).
  {
    const store = createInMemoryJobStore({ j: "scheduled" });
    const r = await Promise.all([store.claim("j"), store.claim("j")]);
    check("2 chamadas concorrentes => exatamente 1 reivindica", r.filter(Boolean).length === 1);
  }

  // 4) Retry reagendado respeita nextAttemptAt/runAt (nao vence antes do backoff).
  {
    const plan = planRetry(0, new Error("WhatsApp API 503:"), now);
    if (!plan.retry) throw new Error("esperava retry para 503");
    check("apos retry, job NAO esta vencido em `now`", isJobDue(plan.nextAttemptAt, now) === false);
    check("apos retry, job vence em nextAttemptAt", isJobDue(plan.nextAttemptAt, plan.nextAttemptAt) === true);
  }

  // 5) Job SENT nao e novamente processado (nem reivindicavel).
  {
    check("canClaim(sent) = false", canClaim("sent") === false);
    const store = createInMemoryJobStore({ j: "sent" });
    check("job sent nao e reivindicado pelo cron", (await store.claim("j")) === false);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
