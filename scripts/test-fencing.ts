// Testes de FENCING do sinal (bloqueador 1) e do lease de enrollment (bloq. 2).
import { canFinalizeSignal, canClaimSignal, SIGNAL_LEASE_MS, type SignalDoc } from "../lib/storefront/signalDoc";
import { canClaimEnroll, canFinalizeEnroll, ENROLL_LEASE_MS, type EnrollDoc } from "../lib/storefront/enrollLease";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
// ===== Bloqueador 1: fencing do lease do SINAL =====
{
  const sig = (over: Partial<SignalDoc>): SignalDoc => ({
    storeId: "s", cartId: "c", receivedAt: 0, lastActivityAt: 0,
    reachedCheckout: true, clientCompleted: false, status: "processing", ...over,
  });
  check("detentor do lease pode finalizar", canFinalizeSignal(sig({ leaseId: "A" }), "A") === true);
  check("não-detentor NÃO pode finalizar", canFinalizeSignal(sig({ leaseId: "B" }), "A") === false);
  check("terminal não é finalizável", canFinalizeSignal(sig({ status: "terminal", leaseId: "A" }), "A") === false);

  // A adquire; lease expira; B assume (novo leaseId); B finaliza; A rejeitado.
  let doc = sig({ status: "processing", leaseAt: 1000, leaseId: "A" });
  const bCanClaim = canClaimSignal(doc.status, doc.leaseAt, 1000 + SIGNAL_LEASE_MS);
  check("A perde lease (expirou) => B pode reivindicar", bCanClaim === true);
  doc = { ...doc, leaseAt: 1000 + SIGNAL_LEASE_MS, leaseId: "B" }; // B assumiu
  doc = { ...doc, status: "terminal", terminalReason: "enrolled" }; // B finalizou
  check("A tenta finalizar após perder lease => rejeitado", canFinalizeSignal(doc, "A") === false);
  check("terminal permanece terminal", doc.status === "terminal");
  check("A tenta voltar p/ pending => rejeitado (não é detentor)", canFinalizeSignal(doc, "A") === false);
}

// ===== Bloqueador 2: lease de ENROLLMENT recuperável + fencing =====
{
  check("ausente => reivindicável", canClaimEnroll(null, 1000) === true);
  check("enrolled => NÃO reivindicável (terminal)", canClaimEnroll({ status: "enrolled" }, 10 ** 12) === false);
  check("enrolling fresco => NÃO reivindicável", canClaimEnroll({ status: "enrolling", leaseAt: 1000 }, 1000 + 60_000) === false);
  check("enrolling expirado => reivindicável (retry)", canClaimEnroll({ status: "enrolling", leaseAt: 1000 }, 1000 + ENROLL_LEASE_MS) === true);
  check("finalize só do detentor", canFinalizeEnroll({ status: "enrolling", leaseId: "A" }, "A") === true);
  check("finalize de não-detentor => não", canFinalizeEnroll({ status: "enrolling", leaseId: "B" }, "A") === false);
  check("finalize de enrolled => não (já terminal)", canFinalizeEnroll({ status: "enrolled", leaseId: "A" }, "A") === false);

  // Simulador do ciclo do enrollCartOnce.
  interface E { doc: EnrollDoc | null }
  async function enrollOnce(store: E, leaseId: string, now: number, enroll: () => Promise<void>): Promise<boolean> {
    if (!canClaimEnroll(store.doc, now)) return false;
    store.doc = { status: "enrolling", leaseId, leaseAt: now };
    await enroll(); // se lançar, propaga: lease fica enrolling e expira -> retry
    if (canFinalizeEnroll(store.doc, leaseId)) store.doc = { status: "enrolled" };
    return true;
  }

  // Falha no enrollment -> lease expira -> retry funciona (sem dedup permanente).
  {
    const store: E = { doc: null };
    let threw = false;
    try {
      await enrollOnce(store, "L1", 1000, async () => {
        throw new Error("enroll falhou");
      });
    } catch {
      threw = true;
    }
    check("2 enroll falha é propagado", threw === true);
    check("2 doc fica enrolling (não enrolled)", store.doc?.status === "enrolling");
    check("2 antes de expirar NÃO reivindicável", canClaimEnroll(store.doc, 1000 + 60_000) === false);
    const retry = await enrollOnce(store, "L2", 1000 + ENROLL_LEASE_MS, async () => {});
    check("2 após lease expirar, retry inscreve", retry === true && store.doc?.status === "enrolled");
  }

  // Sucesso -> enrolled (terminal); duplicata bloqueada.
  {
    const store: E = { doc: null };
    const first = await enrollOnce(store, "L1", 1000, async () => {});
    const second = await enrollOnce(store, "L2", 2000, async () => {});
    check("2 sucesso => enrolled; duplicata bloqueada", first === true && second === false && store.doc?.status === "enrolled");
  }

  // Worker morre após claim -> lease expira -> outro retoma.
  {
    const store: E = { doc: { status: "enrolling", leaseId: "DEAD", leaseAt: 1000 } };
    const recovered = await enrollOnce(store, "L2", 1000 + ENROLL_LEASE_MS, async () => {});
    check("2 lease preso (worker morto) é retomável", recovered === true && store.doc?.status === "enrolled");
  }
}

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
