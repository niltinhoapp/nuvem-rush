"use client";
// Construtor visual de fluxos (SE -> ENTAO) com React Flow.
// Mantem uma cadeia linear: trigger -> step-0 -> step-1 -> ...
import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes";
import { flowToGraph, graphToFlow } from "@/lib/flows/serialize";
import { sessionToken } from "@/lib/nexo";
import type { Flow, Step, Trigger } from "@/types";

// Em producao usa o session token do Nexo; em dev, o atalho x-store-id.
async function authHeaders(devStoreId?: string): Promise<Record<string, string>> {
  if (devStoreId) return { "x-store-id": devStoreId };
  return { Authorization: `Bearer ${await sessionToken()}` };
}

const EMPTY: Pick<Flow, "trigger" | "steps"> = {
  trigger: { event: "order_paid", match: "all", conditions: [] },
  steps: [],
};

interface Props {
  devStoreId?: string; // atalho de desenvolvimento; em prod usa-se o Nexo
  initialFlow?: Flow;
}

export default function FlowBuilder({ devStoreId, initialFlow }: Props) {
  const seed = useMemo(
    () => flowToGraph(initialFlow ?? EMPTY),
    [initialFlow],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges);
  const [name, setName] = useState(initialFlow?.name ?? "Novo fluxo");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Injeta callbacks de edicao no data de cada no (React Flow guarda data plano).
  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      ),
    [setNodes],
  );

  const removeStep = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  const addStep = useCallback(() => {
    setNodes((ns) => {
      const stepCount = ns.filter((n) => n.type === "step").length;
      const id = `step-${Date.now()}`;
      const lastId =
        ns.filter((n) => n.type === "step").slice(-1)[0]?.id ?? "trigger";
      const newNode: Node = {
        id,
        type: "step",
        position: { x: 0, y: 180 * (stepCount + 1) },
        data: {
          step: { delay: { value: 1, unit: "days" }, action: "email" } as Step,
        },
      };
      setEdges((es) => [...es, { id: `e-${id}`, source: lastId, target: id }]);
      return [...ns, newNode];
    });
  }, [setNodes, setEdges]);

  // Reconstroi os data callbacks a cada render (closures atualizadas).
  const nodesWithHandlers = nodes.map((n) => {
    if (n.type === "trigger") {
      return {
        ...n,
        data: {
          ...n.data,
          onChange: (t: Trigger) => patchNodeData(n.id, { trigger: t }),
        },
      };
    }
    return {
      ...n,
      data: {
        ...n.data,
        onChange: (s: Step) => patchNodeData(n.id, { step: s }),
        onRemove: () => removeStep(n.id),
      },
    };
  });

  async function save(status: Flow["status"]) {
    setSaving(true);
    setMsg("");
    try {
      const { trigger, steps } = graphToFlow(nodes, edges);
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders(devStoreId)),
        },
        body: JSON.stringify({
          flowId: initialFlow?.flowId,
          name,
          status,
          trigger,
          steps,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg(status === "active" ? "Fluxo ativado!" : "Rascunho salvo.");
    } catch (e) {
      setMsg("Erro ao salvar: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "80vh" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "8px 10px", border: "1px solid #d7d9dc", borderRadius: 6, flex: 1 }}
        />
        <button onClick={addStep} style={btn("#f5f6f7", "#333")}>+ Acao</button>
        <button disabled={saving} onClick={() => save("draft")} style={btn("#f5f6f7", "#333")}>
          Salvar rascunho
        </button>
        <button disabled={saving} onClick={() => save("active")} style={btn("#3483fa", "#fff")}>
          Ativar fluxo
        </button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>

      <div style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 8 }}>
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

const btn = (bg: string, color: string): React.CSSProperties => ({
  padding: "8px 14px",
  background: bg,
  color,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
});
