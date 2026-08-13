// Testes do endpoint/validação do sinal + segurança do bundle.
import { readFileSync, existsSync } from "node:fs";
import { parseCartSignal, cartEnrollKey } from "../lib/storefront/cartSignal";
import { isAllowedOrigin } from "../lib/storefront/cors";
import { createInMemoryEventClaim } from "../lib/webhooks/idempotency";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

async function main() {
  // ---- Validação (payload UNTRUSTED) ----
  check("válido ACTIVITY", parseCartSignal({ cartId: "c1", phase: "ACTIVITY" }).ok === true);
  check("válido com telemetria opcional", parseCartSignal({ cartId: "c1", phase: "COMPLETED", clientAt: 5, storeId: "s1" }).ok === true);
  check("falta cartId => rejeitado", parseCartSignal({ phase: "ACTIVITY" }).ok === false);
  check("phase inválida => rejeitado", parseCartSignal({ cartId: "c1", phase: "HACK" }).ok === false);
  check("campo extra (strict) => rejeitado", parseCartSignal({ cartId: "c1", phase: "ACTIVITY", email: "a@b.c" }).ok === false);
  check("clientAt não-positivo => rejeitado", parseCartSignal({ cartId: "c1", phase: "ACTIVITY", clientAt: 0 }).ok === false);

  // ---- CORS restritivo ----
  check("CORS aceita origem Nuvemshop", isAllowedOrigin("https://loja.lojavirtualnuvem.com.br") === true);
  check("CORS rejeita origem aleatória", isAllowedOrigin("https://evil.example.com") === false);
  check("CORS rejeita null", isAllowedOrigin(null) === false);

  // ---- Dedup sinal + polling (mesmo cartId) ----
  {
    const claim = createInMemoryEventClaim();
    const key = cartEnrollKey("checkout-123");
    const a = await claim.claim("s", key);
    const b = await claim.claim("s", key);
    check("sinal + polling => 1 inscrição", a === true && b === false);
    check("carrinhos diferentes => chaves diferentes", cartEnrollKey("a") !== cartEnrollKey("b"));
  }

  // ---- 12) bundle NubeSDK sem segredos e sem window/document/React ----
  {
    const forbiddenSecrets = ["CLIENT_SECRET", "ACCESS_TOKEN", "CRON_SECRET", "INTERNAL_DISPATCH_SECRET", "META_APP_SECRET", "PRIVATE_KEY", "process.env"];
    const forbiddenApis = ["window", "document", "jQuery", "innerHTML", "createElement", "react"];
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    const srcCode = stripComments(readFileSync("nubesdk/src/main.ts", "utf8"));
    check("12 fonte do worker sem segredos", forbiddenSecrets.every((s) => !srcCode.includes(s)));
    check("12 fonte do worker sem window/document/React", forbiddenApis.every((s) => !srcCode.includes(s)));

    // Bundle BUILDADO (dist/main.min.js) — evidência real.
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
    check("13 endpoint valida origem (CORS)", route.includes("isAllowedOrigin"));
    check("13 endpoint valida payload (zod)", route.includes("parseCartSignal"));
    check("13 endpoint usa tempo do servidor (Date.now)", route.includes("Date.now()"));
    check("13 endpoint atualiza terminal atomicamente (transaction)", route.includes("runTransaction"));
    check("13 endpoint NÃO roteia por storeId do cliente (coleção global)", route.includes('db.collection("cart_signals")'));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
