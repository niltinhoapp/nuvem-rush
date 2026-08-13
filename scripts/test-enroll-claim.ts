// Testes do claim de inscrição (bloqueador 6: liberar após falha; retry seguro).
import { enrollGuarded } from "../lib/storefront/enrollGuard";
import { createInMemoryEventClaim } from "../lib/webhooks/idempotency";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  // Claim adquirido -> enrollment falha -> claim liberado -> retry futuro funciona.
  {
    const claim = createInMemoryEventClaim();
    let ok = false;
    try {
      await enrollGuarded(claim, "s1", "k", async () => {
        throw new Error("falha de inscrição");
      });
    } catch {
      ok = true;
    }
    check("6 falha na inscrição é propagada", ok === true);
    // Retry: como o claim foi liberado, uma nova tentativa consegue reivindicar.
    const retry = await enrollGuarded(claim, "s1", "k", async () => {});
    check("6 retry após falha inscreve (claim liberado)", retry === true);
  }

  // Sucesso -> claim permanece terminal (não reprocessa).
  {
    const claim = createInMemoryEventClaim();
    const first = await enrollGuarded(claim, "s1", "k", async () => {});
    let calls = 0;
    const second = await enrollGuarded(claim, "s1", "k", async () => {
      calls++;
    });
    check("6 sucesso mantém claim (2ª não inscreve)", first === true && second === false && calls === 0);
  }

  // Concorrência -> apenas um processa.
  {
    const claim = createInMemoryEventClaim();
    let enrollCalls = 0;
    const enroll = async () => {
      enrollCalls++;
    };
    const [a, b] = await Promise.all([
      enrollGuarded(claim, "s1", "k", enroll),
      enrollGuarded(claim, "s1", "k", enroll),
    ]);
    check("6 concorrência => exatamente 1 processa", [a, b].filter(Boolean).length === 1 && enrollCalls === 1);
  }

  // Polling após falha consegue recuperar (simula sinal falho, poll depois).
  {
    const claim = createInMemoryEventClaim();
    try {
      await enrollGuarded(claim, "s1", "cartX", async () => {
        throw new Error("sinal falhou ao inscrever");
      });
    } catch {
      /* liberado */
    }
    const poll = await enrollGuarded(claim, "s1", "cartX", async () => {});
    check("6 polling recupera carrinho que falhou antes", poll === true);
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
