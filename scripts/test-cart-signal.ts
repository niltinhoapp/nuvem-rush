// Testes do endpoint/validação do sinal + segurança do bundle.
import { readFileSync, existsSync } from "node:fs";
import { parseCartSignal } from "../lib/storefront/cartSignal";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  // ---- Validação (payload UNTRUSTED: storeId+cartId obrigatórios) ----
  check("válido ACTIVITY", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "ACTIVITY" }).ok === true);
  check("válido com storeDomain/clientAt", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "COMPLETED", storeDomain: "x.y", clientAt: 5 }).ok === true);
  check("falta storeId => rejeitado", parseCartSignal({ cartId: "c1", phase: "ACTIVITY" }).ok === false);
  check("falta cartId => rejeitado", parseCartSignal({ storeId: "s1", phase: "ACTIVITY" }).ok === false);
  check("phase inválida => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "HACK" }).ok === false);
  check("campo extra (strict) => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "ACTIVITY", email: "a@b.c" }).ok === false);

  // ---- 12) bundle NubeSDK sem segredos e sem window/document/React ----
  {
    const forbiddenSecrets = ["CLIENT_SECRET", "ACCESS_TOKEN", "CRON_SECRET", "INTERNAL_DISPATCH_SECRET", "META_APP_SECRET", "PRIVATE_KEY", "process.env"];
    const forbiddenApis = ["window", "document", "jQuery", "innerHTML", "createElement", "react"];
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const srcCode = stripComments(readFileSync("nubesdk/src/main.ts", "utf8"));
    check("12 fonte do worker sem segredos", forbiddenSecrets.every((s) => !srcCode.includes(s)));
    check("12 fonte do worker sem window/document/React", forbiddenApis.every((s) => !srcCode.includes(s)));

    const bundlePath = "nubesdk/dist/main.min.js";
    if (existsSync(bundlePath)) {
      const bundle = readFileSync(bundlePath, "utf8");
      check("12 bundle buildado sem segredos", forbiddenSecrets.filter((s) => s !== "process.env").every((s) => !bundle.includes(s)));
      check("12 bundle buildado sem window/document/React", forbiddenApis.every((s) => !bundle.includes(s)));
    } else {
      console.log("SKIP  12 bundle não buildado (rode: cd nubesdk && npm run build)");
    }
  }

  // ---- 13) endpoint sem operação privilegiada + autoridade server-side ----
  {
    const route = readFileSync("app/api/storefront/cart-signal/route.ts", "utf8");
    const privileged = ["sendWhatsapp", "sendEmail", "applyTag", "triggerWebhook", "dispatchJob", "enrollCartInFlows", "accessToken", "CRON_SECRET"];
    check("13 endpoint sem envio/enroll/segredo", privileged.every((s) => !route.includes(s)));
    check("13 endpoint valida payload (zod)", route.includes("parseCartSignal"));
    check("13 endpoint usa tempo do servidor (Date.now)", route.includes("Date.now()"));
    check("13 endpoint atualiza terminal atomicamente (transaction)", route.includes("runTransaction"));
    check("13 endpoint valida tenant-origin (originMatchesStore)", route.includes("originMatchesStore"));
    check("13 endpoint checa loja ativa (storeRef)", route.includes("storeRef(storeId)"));
    check("13 endpoint usa identidade hash store-scoped (cartKeyHash)", route.includes("cartKeyHash(cartId)"));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
