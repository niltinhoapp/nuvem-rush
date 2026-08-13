// Testes da idempotência PERSISTIDA de enrollment/jobs (bloqueador 2).
import { enrollmentKey, jobKey, planEnrollment, classifyEnrollment } from "../lib/rules/enrollmentKey";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

// Simulador do createEnrollmentWithJobs transacional (read -> plan -> write).
interface FakeStore {
  enrollments: Set<string>;
  jobs: Set<string>;
}
function enrollTx(store: FakeStore, enrollmentId: string, nSteps: number): boolean {
  const enrollExists = store.enrollments.has(enrollmentId);
  const jobsExist = Array.from({ length: nSteps }, (_, i) => store.jobs.has(jobKey(enrollmentId, i)));
  const plan = planEnrollment(enrollExists, jobsExist);
  if (plan.createEnrollment) store.enrollments.add(enrollmentId);
  for (const i of plan.jobsToCreate) store.jobs.add(jobKey(enrollmentId, i));
  return plan.createEnrollment;
}
const jobCount = (s: FakeStore, id: string) => [...s.jobs].filter((j) => j.startsWith(id + "_")).length;

// ===== IDs determinísticos (G, H) =====
check("G mesma origem, lojas diferentes => enrollments distintos", enrollmentKey("A", "cart1", "flow1") !== enrollmentKey("B", "cart1", "flow1"));
check("H mesmo cart, flows diferentes => um por flow (distinto)", enrollmentKey("A", "cart1", "flow1") !== enrollmentKey("A", "cart1", "flow2"));
check("determinístico (mesmas entradas => mesma chave)", enrollmentKey("A", "c", "f") === enrollmentKey("A", "c", "f"));
check("jobKey determinístico", jobKey("E1", 2) === "E1_2");

// ===== classify / plan =====
check("MISSING", classifyEnrollment(false, [false, false]) === "MISSING");
check("PARTIAL (enroll sem jobs)", classifyEnrollment(true, [false, false]) === "PARTIAL");
check("PARTIAL (jobs parciais)", classifyEnrollment(true, [true, false]) === "PARTIAL");
check("COMPLETE", classifyEnrollment(true, [true, true]) === "COMPLETE");
check("plan cria só ausentes", JSON.stringify(planEnrollment(true, [true, false, false]).jobsToCreate) === "[1,2]");

const flowA = enrollmentKey("s", "cart", "flowA");
const flowB = enrollmentKey("s", "cart", "flowB");

// ===== A) enrollment criado -> crash antes do terminal -> retry -> 1 enrollment =====
{
  const store: FakeStore = { enrollments: new Set(), jobs: new Set() };
  enrollTx(store, flowA, 2); // criou (crash "antes do terminal" = lease não marcado)
  enrollTx(store, flowA, 2); // retry
  check("A retry após crash => exatamente 1 enrollment", store.enrollments.size === 1 && jobCount(store, flowA) === 2);
}

// ===== B) enrollment + job0 -> crash antes de job1 -> retry completa job1, job0 não duplica =====
{
  const store: FakeStore = { enrollments: new Set([flowA]), jobs: new Set([jobKey(flowA, 0)]) }; // estado parcial
  check("B estado parcial reconhecido", classifyEnrollment(true, [true, false]) === "PARTIAL");
  enrollTx(store, flowA, 2); // retry
  check("B retry completa job1 sem duplicar job0", jobCount(store, flowA) === 2 && store.jobs.has(jobKey(flowA, 1)));
}

// ===== C) Flow A termina -> Flow B inicia e falha -> retry -> A não duplica, B completa =====
{
  const store: FakeStore = { enrollments: new Set(), jobs: new Set() };
  enrollTx(store, flowA, 1); // A completo
  // B "falha" (não aplicado). Retry roda os dois:
  enrollTx(store, flowA, 1); // A no-op
  enrollTx(store, flowB, 1); // B completa
  check("C A não duplica e B completa", store.enrollments.size === 2 && jobCount(store, flowA) === 1 && jobCount(store, flowB) === 1);
}

// ===== D) Dois workers simultâneos => 1 conjunto lógico =====
{
  const store: FakeStore = { enrollments: new Set(), jobs: new Set() };
  const w1 = enrollTx(store, flowA, 2); // vence
  const w2 = enrollTx(store, flowA, 2); // converge (no-op)
  check("D 2 workers => 1 enrollment/jobs", w1 === true && w2 === false && store.enrollments.size === 1 && jobCount(store, flowA) === 2);
}

// ===== E) NubeSDK primeiro + polling depois => 1 enrollment =====
// ===== F) Polling primeiro + NubeSDK depois => 1 enrollment =====
{
  const store: FakeStore = { enrollments: new Set(), jobs: new Set() };
  enrollTx(store, flowA, 1); // sinal
  enrollTx(store, flowA, 1); // polling
  check("E/F sinal + polling (qualquer ordem) => 1 enrollment", store.enrollments.size === 1 && jobCount(store, flowA) === 1);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
