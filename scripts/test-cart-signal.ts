// Testes do backend do sinal de carrinho (Fase 8: itens 9, 11, 12, 13, 14).
import { readFileSync } from "node:fs";
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
  // ---- 11) payload inválido rejeitado; válido aceito ----
  check("11 sinal válido aceito", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "CHECKOUT_STARTED", at: 1 }).ok === true);
  check("11 falta campo => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "CHECKOUT_STARTED" }).ok === false);
  check("11 phase inválida => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "HACK", at: 1 }).ok === false);
  check("11 at não-positivo => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "COMPLETED", at: 0 }).ok === false);
  check("11 campo extra (strict) => rejeitado", parseCartSignal({ storeId: "s1", cartId: "c1", phase: "COMPLETED", at: 1, email: "a@b.c" }).ok === false);
  check("11 tipo errado => rejeitado", parseCartSignal({ storeId: 1, cartId: "c1", phase: "COMPLETED", at: 1 }).ok === false);

  // ---- CORS restritivo ----
  check("CORS aceita origem Nuvemshop", isAllowedOrigin("https://minha-loja.lojavirtualnuvem.com.br") === true);
  check("CORS aceita mitiendanube", isAllowedOrigin("https://x.mitiendanube.com") === true);
  check("CORS rejeita origem aleatória", isAllowedOrigin("https://evil.example.com") === false);
  check("CORS rejeita null", isAllowedOrigin(null) === false);
  check("CORS rejeita origem malformada", isAllowedOrigin("not-a-url") === false);

  // ---- 9 + 14) dedup NubeSDK + polling convergem no mesmo cartId ----
  {
    const claim = createInMemoryEventClaim();
    const key = cartEnrollKey("checkout-123");
    // Simula: sinal (fonte A) e polling (fonte B) tentam inscrever o mesmo carrinho.
    const a = await claim.claim("store1", key);
    const b = await claim.claim("store1", key);
    check("9 sinal + polling => 1 inscrição (dedup)", a === true && b === false);
    // 14) polling sozinho (sem sinal) ainda inscreve (fallback funciona).
    const solo = await claim.claim("store1", cartEnrollKey("checkout-999"));
    check("14 polling sozinho inscreve (fallback)", solo === true);
    // Carrinhos diferentes não colidem.
    check("carrinhos diferentes => chaves diferentes", cartEnrollKey("a") !== cartEnrollKey("b"));
  }

  // ---- 12) NENHUM segredo/DOM/React no bundle NubeSDK ----
  {
    const files = ["nubesdk/src/main.ts", "nubesdk/src/nube-sdk.shim.ts"];
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const forbiddenSecrets = [
      "NUVEMSHOP_CLIENT_SECRET", "NUVEMSHOP_ACCESS_TOKEN", "CRON_SECRET",
      "INTERNAL_DISPATCH_SECRET", "META_APP_SECRET", "WHATSAPP_ACCESS_TOKEN",
      "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "process.env",
    ];
    check("12 módulo NubeSDK sem segredos", forbiddenSecrets.every((s) => !src.includes(s)));
    // Remove comentários (as palavras proibidas aparecem no comentário de aviso).
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const forbiddenApis = ["window", "document", "jQuery", "innerHTML", "from \"react\"", "createElement"];
    check("12 módulo NubeSDK sem window/document/DOM/React (no código)", forbiddenApis.every((s) => !code.includes(s)));
  }

  // ---- 13) endpoint NÃO executa operação privilegiada ----
  {
    const route = readFileSync("app/api/storefront/cart-signal/route.ts", "utf8");
    const privileged = [
      "sendWhatsapp", "sendEmail", "applyTag", "triggerWebhook", "dispatchJob",
      "enrollCartInFlows", "accessToken", "CRON_SECRET", "INTERNAL_DISPATCH_SECRET",
    ];
    check("13 endpoint sem envio/enroll/segredo direto", privileged.every((s) => !route.includes(s)));
    check("13 endpoint valida origem (CORS)", route.includes("isAllowedOrigin"));
    check("13 endpoint valida payload (zod)", route.includes("parseCartSignal"));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
