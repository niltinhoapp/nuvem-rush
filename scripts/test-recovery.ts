// Teste da recuperacao de jobs orfaos em "processing".
// Cobre a decisao pura (isOrphanProcessing) e a semantica atomica da
// recuperacao (concorrencia, preservacao de attempts, teto MAX_ATTEMPTS),
// espelhando a transacao Firestore com um CAS sincrono em memoria.
import { isOrphanProcessing, PROCESSING_TIMEOUT_MS } from "../lib/dispatch/claim";
import { MAX_ATTEMPTS } from "../lib/dispatch/retry";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

// Modelo de job em memoria + recuperacao atomica (CAS sincrono = transacao).
interface JobDoc { status: string; claimedAt?: number; attempts?: number }
function recover(job: JobDoc, now: number): boolean {
  if (!isOrphanProcessing(job.status, job.claimedAt, now)) return false; // secao critica
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    job.status = "failed";
    job.attempts = attempts;
  } else {
    job.status = "scheduled";
    job.attempts = attempts;
  }
  return true;
}

async function main() {
  const now = 100 * 60_000; // 100 min
  const OLD = now - PROCESSING_TIMEOUT_MS; // exatamente no limite
  const RECENT = now - 60_000; // 1 min atras (dentro do maxDuration)

  // ---- Decisao pura ----
  check("processing antigo => orfao", isOrphanProcessing("processing", OLD, now) === true);
  check("processing recente => NAO orfao", isOrphanProcessing("processing", RECENT, now) === false);
  check("sent nunca e orfao", isOrphanProcessing("sent", OLD, now) === false);
  check("failed nunca e orfao", isOrphanProcessing("failed", OLD, now) === false);
  check("cancelled nunca e orfao", isOrphanProcessing("cancelled", OLD, now) === false);
  check("scheduled nunca e orfao", isOrphanProcessing("scheduled", OLD, now) === false);
  check("sem claimedAt => nao toca", isOrphanProcessing("processing", undefined, now) === false);
  check("limite exato (>=) conta como orfao", isOrphanProcessing("processing", now - PROCESSING_TIMEOUT_MS, now) === true);

  // ---- Recupera orfao => volta a scheduled, attempts++ ----
  {
    const job: JobDoc = { status: "processing", claimedAt: OLD, attempts: 0 };
    check("recupera orfao (true)", recover(job, now) === true);
    check("orfao volta a scheduled", job.status === "scheduled");
    check("attempts incrementado", job.attempts === 1);
  }

  // ---- NUNCA recupera sent/failed ----
  {
    const sent: JobDoc = { status: "sent", claimedAt: OLD };
    const failed: JobDoc = { status: "failed", claimedAt: OLD };
    check("nao recupera sent", recover(sent, now) === false && sent.status === "sent");
    check("nao recupera failed", recover(failed, now) === false && failed.status === "failed");
  }

  // ---- Concorrencia: dois crons, um so recupera (sem duplicidade) ----
  {
    const job: JobDoc = { status: "processing", claimedAt: OLD, attempts: 0 };
    const r1 = recover(job, now); // 1o cron recupera (status vira scheduled)
    const r2 = recover(job, now); // 2o cron ve scheduled -> nao recupera
    check("2 crons => exatamente 1 recupera", [r1, r2].filter(Boolean).length === 1);
    check("attempts incrementado uma unica vez", job.attempts === 1);
  }

  // ---- Preserva attempts acumulado; ao atingir MAX vira failed ----
  {
    const job: JobDoc = { status: "processing", claimedAt: OLD, attempts: MAX_ATTEMPTS - 1 };
    check("recuperacao no teto (true)", recover(job, now) === true);
    check("attempts esgotado => failed", job.status === "failed" && job.attempts === MAX_ATTEMPTS);
  }

  // ---- Job recente nao e tocado ----
  {
    const job: JobDoc = { status: "processing", claimedAt: RECENT, attempts: 0 };
    check("job recente nao e recuperado", recover(job, now) === false && job.status === "processing");
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
