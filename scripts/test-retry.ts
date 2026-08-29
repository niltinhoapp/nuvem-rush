// Teste da politica de retry/backoff (Fase E) usando os helpers reais.
import { isTransient, backoffMs, planRetry, MAX_ATTEMPTS } from "../lib/dispatch/retry";
import { canClaim } from "../lib/dispatch/claim";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

// Simulador que espelha a logica de dispatchJob (claim -> send -> retry/terminal)
// para validar a semantica end-to-end com os helpers reais.
interface JobState { status: string; attempts: number; runAt: number }
async function attemptDispatch(job: JobState, send: () => Promise<void>, now: number) {
  if (!canClaim(job.status)) return "skipped" as const;
  job.status = "processing"; // claim atomico (sincrono, sem await antes)
  try {
    await send();
  } catch (err) {
    const plan = planRetry(job.attempts, err, now);
    if (plan.retry) {
      job.status = "scheduled";
      job.attempts = plan.attempts;
      job.runAt = plan.nextAttemptAt;
      return "retry" as const;
    }
    job.status = "failed";
    job.attempts = plan.attempts;
    return "failed" as const;
  }
  job.status = "sent";
  return "sent" as const;
}

async function main() {
  // ---- Classificacao transitorio x permanente ----
  check("429 e transitorio", isTransient(new Error("WhatsApp API 429: rate limit")) === true);
  check("503 e transitorio", isTransient(new Error("WhatsApp API 503: unavailable")) === true);
  check("500 e transitorio", isTransient(new Error("Resend API 500: server error")) === true);
  check("400 e permanente", isTransient(new Error("WhatsApp API 400: bad param")) === false);
  check("401 e permanente", isTransient(new Error("WhatsApp API 401: invalid token")) === false);
  check("404 e permanente", isTransient(new Error("API 404: not found")) === false);
  check("timeout e transitorio", isTransient(new Error("request timeout")) === true);
  check("ECONNRESET e transitorio", isTransient(new Error("read ECONNRESET")) === true);
  check("sem template e permanente", isTransient(new Error("sem template de WhatsApp configurado")) === false);
  check("nao configurada e permanente", isTransient(new Error("OPENAI_API_KEY nao configurada")) === false);
  check("desconhecido e permanente (sem tempestade)", isTransient(new Error("algo estranho")) === false);

  // ---- Backoff limitado e crescente ----
  check("backoff(1) = 1min", backoffMs(1) === 60_000);
  check("backoff(2) = 2min", backoffMs(2) === 120_000);
  check("backoff(3) = 4min", backoffMs(3) === 240_000);
  check("backoff cresce", backoffMs(4) > backoffMs(3));
  check("backoff tem teto de 1h", backoffMs(50) === 60 * 60_000);

  // ---- planRetry ----
  {
    const p = planRetry(0, new Error("API 503:"), 1000);
    check("transitorio => retry com backoff", p.retry === true && "nextAttemptAt" in p && p.nextAttemptAt === 1000 + 60_000);
    check("transitorio => attempts incrementa", p.attempts === 1);
  }
  check("permanente => sem retry", planRetry(0, new Error("API 400:"), 0).retry === false);
  check("ultima tentativa => sem retry (max)", planRetry(MAX_ATTEMPTS - 1, new Error("API 503:"), 0).retry === false);

  // ---- Fluxo: sucesso imediato ----
  {
    const job: JobState = { status: "scheduled", attempts: 0, runAt: 0 };
    let sends = 0;
    const r = await attemptDispatch(job, async () => { sends++; }, 0);
    check("sucesso imediato => sent, 1 envio", r === "sent" && job.status === "sent" && sends === 1);
  }

  // ---- Fluxo: falha transitoria -> retry -> sucesso (sem duplicar) ----
  {
    const job: JobState = { status: "scheduled", attempts: 0, runAt: 0 };
    let sends = 0;
    let now = 0;
    const r1 = await attemptDispatch(job, async () => { sends++; throw new Error("API 503:"); }, now);
    check("1a falha transitoria => retry", r1 === "retry" && job.status === "scheduled" && job.attempts === 1);
    check("retry agenda no futuro (backoff)", job.runAt > now);
    now = job.runAt; // cron so repega quando runAt<=now
    const r2 = await attemptDispatch(job, async () => { sends++; }, now);
    check("sucesso apos retry => sent", r2 === "sent" && job.status === "sent");
    check("total de envios = 2 (sem duplicar sucesso)", sends === 2);
  }

  // ---- Fluxo: falha transitoria ininterrupta para em MAX_ATTEMPTS ----
  {
    const job: JobState = { status: "scheduled", attempts: 0, runAt: 0 };
    let sends = 0;
    let now = 0;
    let guard = 0;
    while (job.status === "scheduled" && guard++ < 20) {
      now = Math.max(now, job.runAt);
      await attemptDispatch(job, async () => { sends++; throw new Error("API 503:"); }, now);
    }
    check("transitorio persistente termina em failed", job.status === "failed");
    check("numero de envios limitado a MAX_ATTEMPTS", sends === MAX_ATTEMPTS);
  }

  // ---- Fluxo: falha permanente falha na 1a, sem retry ----
  {
    const job: JobState = { status: "scheduled", attempts: 0, runAt: 0 };
    let sends = 0;
    const r = await attemptDispatch(job, async () => { sends++; throw new Error("sem template de WhatsApp configurado"); }, 0);
    check("permanente => failed na 1a", r === "failed" && job.status === "failed" && sends === 1);
  }

  // ---- Concorrencia: dois workers no mesmo job, so um envia ----
  {
    const job: JobState = { status: "scheduled", attempts: 0, runAt: 0 };
    let sends = 0;
    const send = async () => { sends++; };
    const [a, b] = await Promise.all([attemptDispatch(job, send, 0), attemptDispatch(job, send, 0)]);
    check("2 workers => 1 sent, 1 skipped", [a, b].filter((x) => x === "sent").length === 1 && [a, b].includes("skipped"));
    check("concorrencia => apenas 1 envio", sends === 1);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
