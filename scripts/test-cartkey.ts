// Testes da identidade de carrinho sem colisão (bloqueador 4).
import { cartKeyHash } from "../lib/storefront/cartKey";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

// Entradas que colidiriam sob substituição de ":" e "/" -> DEVEM ser distintas.
const a = cartKeyHash("abc/def");
const b = cartKeyHash("abc:def");
const c = cartKeyHash("abc_def");
check("abc/def, abc:def, abc_def => 3 identidades distintas", new Set([a, b, c]).size === 3);
check("determinística", cartKeyHash("abc/def") === a);
check("é doc id válido (hex, sem / nem :)", /^[a-f0-9]{64}$/.test(a));
check("entradas diferentes => hashes diferentes", cartKeyHash("x") !== cartKeyHash("y"));
check("mesma entrada => mesmo hash", cartKeyHash("checkout-123") === cartKeyHash("checkout-123"));

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
