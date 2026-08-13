// Testes do vínculo Origin↔loja (bloqueador 3).
import { originMatchesStore, hasKnownDomains } from "../lib/storefront/tenantOrigin";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

const storeA = { domains: ["www.lojaA.com"], originalDomain: "lojaa.nuvemshop.com.br" };
const storeB = { domains: ["www.lojaB.com"], originalDomain: "lojab.nuvemshop.com.br" };

// origem da loja A + loja A => aceita (domínio próprio e original).
check("origem própria de A + A => aceita", originMatchesStore("https://www.lojaA.com", storeA) === true);
check("origem original de A + A => aceita", originMatchesStore("https://lojaa.nuvemshop.com.br", storeA) === true);
check("subdomínio do domínio de A => aceita", originMatchesStore("https://checkout.lojaA.com", storeA) === true);

// origem da loja A + loja B => REJEITA (sufixo genérico não basta).
check("origem de A validada contra B => rejeita", originMatchesStore("https://www.lojaA.com", storeB) === false);
check("original de A contra B => rejeita", originMatchesStore("https://lojaa.nuvemshop.com.br", storeB) === false);

// origem externa => rejeita.
check("origem externa => rejeita", originMatchesStore("https://evil.example.com", storeA) === false);
check("origem nuvemshop de OUTRA loja => rejeita", originMatchesStore("https://outra.nuvemshop.com.br", storeA) === false);

// null / malformada => rejeita.
check("null => rejeita", originMatchesStore(null, storeA) === false);
check("malformada => rejeita", originMatchesStore("not-a-url", storeA) === false);

// sem domínios conhecidos => não afirma match (cold-start).
check("sem domínios => hasKnownDomains false", hasKnownDomains({}) === false);
check("sem domínios => originMatchesStore false", originMatchesStore("https://www.lojaA.com", {}) === false);
check("com domínios => hasKnownDomains true", hasKnownDomains(storeA) === true);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
