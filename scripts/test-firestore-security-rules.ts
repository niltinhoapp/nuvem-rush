// Contrato de seguranca do Firestore: o app acessa dados somente pelo backend
// com Firebase Admin SDK. Nenhum cliente pode ler ou escrever diretamente.
//
// O repositorio ainda nao possui firebase-tools nem @firebase/rules-unit-testing;
// por isso este teste valida estritamente a unica ruleset aceita. Quando o
// Emulator for incorporado, estes mesmos cenarios devem virar testes funcionais.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
const normalized = rules.replace(/\s+/g, " ").trim();
const expected = [
  "rules_version = '2';",
  "service cloud.firestore {",
  "match /databases/{database}/documents {",
  "match /{document=**} {",
  "allow read, write: if false;",
  "}",
  "}",
  "}",
].join(" ");

assert.equal(normalized, expected, "firestore.rules deve ser deny-all sem excecoes");
assert.equal((rules.match(/\ballow\b/g) ?? []).length, 1, "deve existir um unico allow");
assert.doesNotMatch(rules, /isOwner|ownerUid|storeIds|match\s+\/users\//);

const deniedScenarios = [
  "usuario nao autenticado nao le nada",
  "usuario autenticado nao le nada",
  "usuario autenticado nao escreve users/{uid}",
  "usuario nao cria storeIds",
  "usuario nao le flows",
  "usuario nao escreve flows",
  "usuario nao le contacts/orders/carts/logs",
  "cart_signals/cart_enrollments/jobs permanecem deny-all",
  "nenhuma colecao comercial possui acesso client-side",
];

for (const scenario of deniedScenarios) {
  assert.match(normalized, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
  console.log(`PASS  ${scenario}`);
}

console.log("\nfirestore security rules: deny-all confirmado");
