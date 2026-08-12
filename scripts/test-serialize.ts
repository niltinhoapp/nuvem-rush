// Teste de caracterizacao/regressao do Flow Builder (bug B1).
// Garante que remover um step do canvas RELIGA a cadeia e nunca descarta
// silenciosamente os steps posteriores, e que o round-trip flowToGraph <->
// graphToFlow preserva ordem, trigger, conditions, delay, action, templateId,
// aiPrompt e config.
import {
  flowToGraph,
  graphToFlow,
  removeStepNode,
  collectOrphanStepIds,
} from "../lib/flows/serialize";
import type { Flow, Step, Trigger } from "../types";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}
// Assinatura curta de um step para comparar identidade/ordem sem depender de id.
const sig = (s: Step) =>
  `${s.action}|${s.delay.value}${s.delay.unit}|${s.aiPrompt ?? ""}|${s.templateId ?? ""}|${JSON.stringify(s.config ?? {})}`;
const sigs = (steps: Step[]) => steps.map(sig).join(" > ");

const trigger: Trigger = {
  event: "order_paid",
  match: "all",
  conditions: [{ field: "item.sku", op: "eq", value: "SKU1" }],
};

// 4 steps com dados DISTINTOS em todos os campos que precisam sobreviver.
const A: Step = { delay: { value: 1, unit: "days" }, action: "email", aiPrompt: "promptA", templateId: "tplA" };
const B: Step = { delay: { value: 2, unit: "hours" }, action: "whatsapp", aiPrompt: "promptB", config: { whatsappTemplateName: "waB" } };
const C: Step = { delay: { value: 3, unit: "minutes" }, action: "tag", config: { tagName: "vipC" } };
const D: Step = { delay: { value: 4, unit: "days" }, action: "webhook", config: { webhookUrl: "https://d" } };

const flow: Pick<Flow, "trigger" | "steps"> = { trigger, steps: [A, B, C, D] };
const SA = sig(A), SB = sig(B), SC = sig(C), SD = sig(D);

// ---- Round-trip flowToGraph -> graphToFlow ----
{
  const g = flowToGraph(flow);
  const back = graphToFlow(g.nodes, g.edges);
  check("round-trip preserva 4 steps em ordem", sigs(back.steps) === `${SA} > ${SB} > ${SC} > ${SD}`);
  check("round-trip preserva trigger.event", back.trigger.event === "order_paid");
  check("round-trip preserva match", back.trigger.match === "all");
  check("round-trip preserva conditions", JSON.stringify(back.trigger.conditions) === JSON.stringify(trigger.conditions));
  check("round-trip preserva aiPrompt", back.steps[0]!.aiPrompt === "promptA");
  check("round-trip preserva templateId", back.steps[0]!.templateId === "tplA");
  check("round-trip preserva config (whatsapp)", (back.steps[1]!.config as { whatsappTemplateName?: string }).whatsappTemplateName === "waB");
  check("round-trip preserva delay unit/value", back.steps[1]!.delay.unit === "hours" && back.steps[1]!.delay.value === 2);
}

// ---- Round-trip graphToFlow -> flowToGraph -> graphToFlow (estavel) ----
{
  const g1 = flowToGraph(flow);
  const f1 = graphToFlow(g1.nodes, g1.edges);
  const g2 = flowToGraph(f1);
  const f2 = graphToFlow(g2.nodes, g2.edges);
  check("round-trip duplo e estavel", sigs(f1.steps) === sigs(f2.steps));
}

// Helper: ids na ordem step-0..step-3 sao deterministicos no flowToGraph.
const idOf = (i: number) => `step-${i}`;

// ---- Excluir STEP INTERMEDIARIO (B): A -> C -> D, nunca orfaos ----
{
  const g = flowToGraph(flow);
  const r = removeStepNode(g.nodes, g.edges, idOf(1)); // remove B
  check("remover B nao deixa orfaos", collectOrphanStepIds(r.nodes, r.edges).length === 0);
  const back = graphToFlow(r.nodes, r.edges);
  check("remover B => A > C > D", sigs(back.steps) === `${SA} > ${SC} > ${SD}`);
}

// ---- Excluir PRIMEIRO step (A): trigger passa a apontar para B ----
{
  const g = flowToGraph(flow);
  const r = removeStepNode(g.nodes, g.edges, idOf(0));
  check("remover primeiro nao deixa orfaos", collectOrphanStepIds(r.nodes, r.edges).length === 0);
  check("remover primeiro => B > C > D", sigs(graphToFlow(r.nodes, r.edges).steps) === `${SB} > ${SC} > ${SD}`);
}

// ---- Excluir ULTIMO step (D) ----
{
  const g = flowToGraph(flow);
  const r = removeStepNode(g.nodes, g.edges, idOf(3));
  check("remover ultimo nao deixa orfaos", collectOrphanStepIds(r.nodes, r.edges).length === 0);
  check("remover ultimo => A > B > C", sigs(graphToFlow(r.nodes, r.edges).steps) === `${SA} > ${SB} > ${SC}`);
}

// ---- Fluxo com 1 step: remover deixa cadeia vazia, sem orfaos ----
{
  const g = flowToGraph({ trigger, steps: [A] });
  const r = removeStepNode(g.nodes, g.edges, idOf(0));
  check("1 step removido => 0 steps", graphToFlow(r.nodes, r.edges).steps.length === 0);
  check("1 step removido => sem orfaos", collectOrphanStepIds(r.nodes, r.edges).length === 0);
}

// ---- Regressao do bug: remocao NAIVE (sem religar) deve ser DETECTADA como orfa ----
{
  const g = flowToGraph(flow);
  // Simula o comportamento antigo: remove o no e as edges que o tocam, SEM religar.
  const naiveNodes = g.nodes.filter((n) => n.id !== idOf(1));
  const naiveEdges = g.edges.filter((e) => e.source !== idOf(1) && e.target !== idOf(1));
  const orphans = collectOrphanStepIds(naiveNodes, naiveEdges);
  check("remocao naive de B deixa C e D orfaos (bug detectado)", orphans.includes(idOf(2)) && orphans.includes(idOf(3)));
  check("validacao defensiva bloquearia salvamento (orphans > 0)", orphans.length > 0);
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
