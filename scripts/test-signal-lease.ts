// Testes do LEASE do sinal (bloqueador 2): terminal só após enrollment concluir;
// falha volta a pending; concorrência protegida; lease preso é recuperável.
import { canClaimSignal, SIGNAL_LEASE_MS, type SignalStatus } from "../lib/storefront/signalDoc";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

// ---- canClaimSignal ----
check("pending => reivindicável", canClaimSignal("pending", undefined, 1000) === true);
check("processing fresco => NÃO reivindicável", canClaimSignal("processing", 1000, 1000 + 60_000) === false);
check("processing com lease vencido => reivindicável", canClaimSignal("processing", 1000, 1000 + SIGNAL_LEASE_MS) === true);
check("terminal => NUNCA reivindicável", canClaimSignal("terminal", undefined, 10 ** 12) === false);

// Simulador do fluxo do cron (lease -> processing -> terminal | pending).
interface Sig { status: SignalStatus; leaseAt?: number }
function lease(sig: Sig, now: number): boolean {
  if (!canClaimSignal(sig.status, sig.leaseAt, now)) return false;
  sig.status = "processing";
  sig.leaseAt = now;
  return true;
}
async function processSignal(sig: Sig, now: number, enroll: () => Promise<boolean>): Promise<"terminal" | "pending" | "skip"> {
  if (!lease(sig, now)) return "skip";
  try {
    const did = await enroll(); // false = dedup (outro caminho já concluiu)
    sig.status = "terminal"; // terminal SÓ após concluir
    (sig as { reason?: string }).reason = did ? "enrolled" : "deduped";
    return "terminal";
  } catch {
    sig.status = "pending"; // falha -> volta a pending (retry)
    sig.leaseAt = undefined;
    return "pending";
  }
}

async function main() {
  // Falha em sync/enroll -> retry possível (volta a pending, reivindicável depois).
  {
    const sig: Sig = { status: "pending" };
    const r = await processSignal(sig, 1000, async () => {
      throw new Error("falha em sync/enroll");
    });
    check("2 falha => volta a pending", r === "pending" && sig.status === "pending");
    check("2 pending após falha é reivindicável (retry)", canClaimSignal(sig.status, sig.leaseAt, 2000) === true);
  }

  // Sucesso -> terminal.
  {
    const sig: Sig = { status: "pending" };
    const r = await processSignal(sig, 1000, async () => true);
    check("2 sucesso => terminal", r === "terminal" && sig.status === "terminal");
    check("2 terminal não é reivindicável de novo", canClaimSignal(sig.status, sig.leaseAt, 10 ** 12) === false);
  }

  // Dedup (enroll retorna false) -> terminal (deduped).
  {
    const sig: Sig = { status: "pending" };
    await processSignal(sig, 1000, async () => false);
    check("2 dedup => terminal (deduped)", sig.status === "terminal" && (sig as { reason?: string }).reason === "deduped");
  }

  // Concorrência: dois workers, só um leva (o outro não reivindica).
  {
    const sig: Sig = { status: "pending" };
    const w1 = lease(sig, 1000);
    const w2 = lease(sig, 1000); // já em processing (lease fresco)
    check("2 concorrência => só um reivindica", w1 === true && w2 === false);
  }

  // Worker morre após claim (processing, lease vencido) -> recuperável.
  {
    const sig: Sig = { status: "processing", leaseAt: 1000 };
    const recoverable = canClaimSignal(sig.status, sig.leaseAt, 1000 + SIGNAL_LEASE_MS);
    check("2 lease preso (worker morto) é recuperável", recoverable === true);
    const r = await processSignal(sig, 1000 + SIGNAL_LEASE_MS, async () => true);
    check("2 recuperação conclui em terminal", r === "terminal");
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
