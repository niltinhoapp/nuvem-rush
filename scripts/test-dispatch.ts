// Teste do claim atomico de job (B3) e da cota (B6). Usa a store em memoria,
// que espelha a semantica compare-and-set da transacao do Firestore.
import {
  canClaim,
  quotaUsageField,
  hasQuota,
  createInMemoryJobStore,
} from "../lib/dispatch/claim";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  // ---- canClaim: so "scheduled" ----
  check("canClaim(scheduled) = true", canClaim("scheduled") === true);
  check("canClaim(processing) = false", canClaim("processing") === false);
  check("canClaim(sent) = false", canClaim("sent") === false);
  check("canClaim(failed) = false", canClaim("failed") === false);
  check("canClaim(cancelled) = false", canClaim("cancelled") === false);

  // ---- Dois workers, mesmo job scheduled: exatamente um vence ----
  {
    const store = createInMemoryJobStore({ j1: "scheduled" });
    const results = await Promise.all([store.claim("j1"), store.claim("j1")]);
    check("2 workers no mesmo job => exatamente 1 vence", results.filter((r) => r).length === 1);
    check("job fica em processing apos claim", store.get("j1") === "processing");
  }

  // ---- Job ja enviado nao e reivindicado ----
  {
    const store = createInMemoryJobStore({ j2: "sent" });
    check("job ja enviado => claim false", (await store.claim("j2")) === false);
  }

  // ---- Job em processamento nao e reivindicado por outro worker ----
  {
    const store = createInMemoryJobStore({ j3: "processing" });
    check("job em processing => claim false", (await store.claim("j3")) === false);
  }

  // ---- Falha apos claim: fica failed (nao volta a scheduled sozinho) ----
  {
    const store = createInMemoryJobStore({ j4: "scheduled" });
    await store.claim("j4");
    await store.markFailed("j4");
    check("falha apos claim => failed", store.get("j4") === "failed");
    check("job failed nao e reivindicavel", (await store.claim("j4")) === false);
  }

  // ---- 3 workers concorrentes ----
  {
    const store = createInMemoryJobStore({ j5: "scheduled" });
    const r = await Promise.all([store.claim("j5"), store.claim("j5"), store.claim("j5")]);
    check("3 workers => exatamente 1 vence", r.filter((x) => x).length === 1);
  }

  // ---- Cota: campo por canal + limite ----
  check("quotaUsageField(whatsapp)", quotaUsageField(true) === "quotas.whatsappMonthUsed");
  check("quotaUsageField(email)", quotaUsageField(false) === "quotas.dispatchesMonthUsed");
  check("hasQuota(5,10) = true", hasQuota(5, 10) === true);
  check("hasQuota(10,10) = false", hasQuota(10, 10) === false);
  check("hasQuota(11,10) = false", hasQuota(11, 10) === false);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
