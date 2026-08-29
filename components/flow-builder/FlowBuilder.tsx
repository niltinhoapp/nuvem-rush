"use client";
// Construtor visual de fluxos (SE -> ENTAO) com React Flow.
// Mantem uma cadeia linear: trigger -> step-0 -> step-1 -> ...
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Box, Input, Button, Text, Icon, Modal } from "@nimbus-ds/components";
import { PlusCircleIcon, DisketteIcon, RocketIcon, StopIcon, PlayIcon, TrashIcon } from "@nimbus-ds/icons";
import { nodeTypes } from "./nodes";
import { flowToGraph, graphToFlow, removeStepNode, collectOrphanStepIds } from "@/lib/flows/serialize";
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
  const router = useRouter();
  const seed = useMemo(
    () => flowToGraph(initialFlow ?? EMPTY),
    [initialFlow],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges);
  const [name, setName] = useState(initialFlow?.name ?? "Novo fluxo");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState(initialFlow?.status);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Injeta callbacks de edicao no data de cada no (React Flow guarda data plano).
  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      ),
    [setNodes],
  );

  // Remove o step RELIGANDO a cadeia (A->B->C, remover B => A->C). Sem religar,
  // os steps posteriores virariam orfaos e seriam descartados ao salvar (B1).
  const removeStep = useCallback(
    (id: string) => {
      const { nodes: nn, edges: ne } = removeStepNode(nodes, edges, id);
      setNodes(nn);
      setEdges(ne);
    },
    [nodes, edges, setNodes, setEdges],
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

  // Gatilho atual (fluxo linear: 1 trigger por fluxo) — repassado aos steps
  // só para exibir qual template de WhatsApp cada ação enviaria.
  const triggerEvent = (nodes.find((n) => n.type === "trigger")?.data.trigger as Trigger | undefined)?.event;

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
        triggerEvent,
        onChange: (s: Step) => patchNodeData(n.id, { step: s }),
        onRemove: () => removeStep(n.id),
      },
    };
  });

  async function save(status: Flow["status"]) {
    // Validacao defensiva: nao salvar/ativar se houver acoes desconectadas do
    // gatilho — elas seriam perdidas silenciosamente na serializacao (B1).
    const orphans = collectOrphanStepIds(nodes, edges);
    if (orphans.length > 0) {
      setMsg(
        `Há ${orphans.length} ação(ões) desconectada(s) do gatilho. ` +
          "Reconecte todas as ações à cadeia antes de salvar.",
      );
      return;
    }
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
      if (!res.ok) {
        if (res.status === 402) {
          setMsg("Seu período grátis terminou. Assine o plano para ativar automações.");
          return;
        }
        throw new Error("Não foi possível salvar o fluxo.");
      }
      setMsg(status === "active" ? "Fluxo ativado!" : "Rascunho salvo.");
      setStatus(status);
    } catch (e) {
      setMsg("Erro ao salvar: " + String(e));
    } finally {
      setSaving(false);
    }
  }

  // Replica pausar/ativar/excluir aqui — mesmos endpoints da listagem
  // (PATCH/DELETE /api/flows/:id), so disponivel para um fluxo ja salvo.
  async function togglePause() {
    if (!initialFlow?.flowId) return;
    const next = status === "active" ? "paused" : "active";
    setLifecycleBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/flows/${initialFlow.flowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders(devStoreId)) },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        if (res.status === 402) {
          setMsg("Seu período grátis terminou. Assine o plano para reativar automações.");
          return;
        }
        throw new Error("Não foi possível alterar o status do fluxo.");
      }
      setStatus(next);
      setMsg(
        next === "paused"
          ? "Fluxo pausado. Novas inscrições e envios pendentes foram interrompidos."
          : "Fluxo reativado. Voltando a aceitar novas inscrições.",
      );
    } catch (e) {
      setMsg("Erro ao alterar o fluxo: " + String(e));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function confirmAndDelete() {
    if (!initialFlow?.flowId) return;
    setLifecycleBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/flows/${initialFlow.flowId}`, {
        method: "DELETE",
        headers: await authHeaders(devStoreId),
      });
      if (!res.ok) throw new Error("Não foi possível excluir o fluxo.");
      router.push("/dashboard");
    } catch (e) {
      setMsg("Erro ao excluir o fluxo: " + String(e));
      setLifecycleBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Box display="flex" flexDirection="column" height="80vh" gap="3">
      <Box
        display="flex"
        gap="2"
        alignItems="center"
        padding="3"
        backgroundColor="neutral-background"
        borderRadius="2"
        borderColor="neutral-surfaceHighlight"
        borderWidth="1"
        borderStyle="solid"
        boxShadow="1"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do fluxo"
        />
        <Button appearance="neutral" onClick={addStep}>
          <Icon source={<PlusCircleIcon size={16} />} color="currentColor" />
          Ação
        </Button>
        <Button appearance="neutral" disabled={saving} onClick={() => save("draft")}>
          <Icon source={<DisketteIcon size={16} />} color="currentColor" />
          Salvar rascunho
        </Button>
        <Button appearance="primary" disabled={saving} onClick={() => save("active")}>
          <Icon source={<RocketIcon size={16} />} color="currentColor" />
          Ativar fluxo
        </Button>
        {initialFlow?.flowId && status !== "draft" && (
          <Button appearance="neutral" disabled={lifecycleBusy} onClick={togglePause}>
            <Icon
              source={status === "active" ? <StopIcon size={16} /> : <PlayIcon size={16} />}
              color="currentColor"
            />
            {status === "active" ? "Pausar" : "Ativar"}
          </Button>
        )}
        {initialFlow?.flowId && (
          <Button appearance="neutral" disabled={lifecycleBusy} onClick={() => setConfirmDelete(true)}>
            <Icon source={<TrashIcon size={16} />} color="danger-textLow" />
            Excluir
          </Button>
        )}
        {msg && (
          <Text fontSize="caption" color="neutral-textLow">
            {msg}
          </Text>
        )}
      </Box>

      <Box
        flex="1"
        borderColor="neutral-surfaceHighlight"
        borderWidth="1"
        borderStyle="solid"
        borderRadius="2"
        overflow="hidden"
      >
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
      </Box>

      <Modal open={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
        <Modal.Header title="Excluir fluxo" />
        <Modal.Body>
          <Text>
            Tem certeza que deseja excluir o fluxo <b>{name}</b>? Os contatos já inscritos e o
            histórico de envios são preservados, mas o fluxo some da listagem e para de disparar.
          </Text>
        </Modal.Body>
        <Modal.Footer>
          <Box display="flex" gap="2" justifyContent="flex-end" width="100%">
            <Button onClick={() => setConfirmDelete(false)} disabled={lifecycleBusy}>Cancelar</Button>
            <Button appearance="danger" onClick={confirmAndDelete} disabled={lifecycleBusy}>
              {lifecycleBusy ? "Excluindo..." : "Excluir fluxo"}
            </Button>
          </Box>
        </Modal.Footer>
      </Modal>
    </Box>
  );
}
