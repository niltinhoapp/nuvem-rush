// Conversao entre o grafo do React Flow e o modelo Flow (trigger + steps).
// O grafo e uma cadeia linear: trigger -> step-0 -> step-1 -> ...
import type { Node, Edge } from "@xyflow/react";
import type { Flow, Step, Trigger } from "@/types";

export interface TriggerNodeData extends Record<string, unknown> {
  trigger: Trigger;
}
export interface StepNodeData extends Record<string, unknown> {
  step: Step;
}

const TRIGGER_ID = "trigger";
const stepId = (i: number) => `step-${i}`;

// Modelo -> grafo (para renderizar um fluxo existente no canvas).
export function flowToGraph(flow: Pick<Flow, "trigger" | "steps">): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [
    {
      id: TRIGGER_ID,
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { trigger: flow.trigger } satisfies TriggerNodeData,
    },
  ];
  const edges: Edge[] = [];

  flow.steps.forEach((step, i) => {
    nodes.push({
      id: stepId(i),
      type: "step",
      position: { x: 0, y: 180 * (i + 1) },
      data: { step } satisfies StepNodeData,
    });
    edges.push({
      id: `e-${i}`,
      source: i === 0 ? TRIGGER_ID : stepId(i - 1),
      target: stepId(i),
    });
  });

  return { nodes, edges };
}

// Grafo -> modelo (para salvar). Ordena os steps seguindo a cadeia de edges.
export function graphToFlow(nodes: Node[], edges: Edge[]): {
  trigger: Trigger;
  steps: Step[];
} {
  const triggerNode = nodes.find((n) => n.id === TRIGGER_ID);
  const trigger = (triggerNode?.data as TriggerNodeData | undefined)?.trigger ?? {
    event: "order_paid",
    match: "all",
    conditions: [],
  };

  // Mapa source -> target para percorrer a cadeia em ordem.
  const nextOf = new Map(edges.map((e) => [e.source, e.target]));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const steps: Step[] = [];
  let cursor = nextOf.get(TRIGGER_ID);
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const node = byId.get(cursor);
    const step = (node?.data as StepNodeData | undefined)?.step;
    if (step) steps.push(step);
    cursor = nextOf.get(cursor);
  }

  return { trigger, steps };
}

// Remove um no de step RELIGANDO a cadeia: o antecessor passa a apontar para
// o sucessor (A->B->C, remover B => A->C). Sem isto, remover um no do meio
// deixa as edges com um buraco e todos os steps POSTERIORES ficam orfaos —
// graphToFlow, que percorre a cadeia a partir do trigger, os descarta
// silenciosamente ao salvar (bug B1). Funcao pura para poder ser testada.
export function removeStepNode(
  nodes: Node[],
  edges: Edge[],
  id: string,
): { nodes: Node[]; edges: Edge[] } {
  const incoming = edges.find((e) => e.target === id);
  const outgoing = edges.find((e) => e.source === id);

  const nextNodes = nodes.filter((n) => n.id !== id);
  let nextEdges = edges.filter((e) => e.source !== id && e.target !== id);

  // So religa quando havia antecessor E sucessor (no do meio). Ao remover o
  // primeiro, o trigger passa a apontar para o proximo; ao remover o ultimo,
  // nao ha sucessor e nada precisa ser religado.
  if (incoming && outgoing) {
    nextEdges = [
      ...nextEdges,
      {
        id: `e-${incoming.source}-${outgoing.target}`,
        source: incoming.source,
        target: outgoing.target,
      },
    ];
  }

  return { nodes: nextNodes, edges: nextEdges };
}

// Validacao defensiva: IDs de nos de step que NAO fazem parte da cadeia linear
// a partir do trigger (orfaos). Usado antes de salvar/ativar para BLOQUEAR o
// salvamento em vez de perder acoes em silencio.
export function collectOrphanStepIds(nodes: Node[], edges: Edge[]): string[] {
  const nextOf = new Map(edges.map((e) => [e.source, e.target]));
  const visited = new Set<string>();
  let cursor = nextOf.get(TRIGGER_ID);
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    visited.add(cursor);
    cursor = nextOf.get(cursor);
  }
  return nodes
    .filter((n) => n.type === "step" && !visited.has(n.id))
    .map((n) => n.id);
}
