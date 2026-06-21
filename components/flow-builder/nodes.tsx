"use client";
// Nos customizados do construtor: TriggerNode (SE) e StepNode (ENTAO).
// Edicao inline e propagada via callbacks guardados em node.data.
// Classes nodrag/nowheel: evitam que interagir com os campos arraste o no
// ou que a rolagem do mouse de zoom no canvas (ou incremente o input number).
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type {
  Condition,
  ConditionField,
  ConditionOp,
  Step,
  Trigger,
} from "@/types";

const FIELDS: { value: ConditionField; label: string }[] = [
  { value: "item.sku", label: "SKU comprado" },
  { value: "item.category", label: "Categoria" },
  { value: "item.brand", label: "Marca" },
  { value: "item.productId", label: "Produto (ID)" },
  { value: "order.total", label: "Valor do pedido" },
  { value: "order.itemsCount", label: "Qtd. de itens" },
  { value: "customer.type", label: "Tipo de cliente" },
];

const OPS: { value: ConditionOp; label: string }[] = [
  { value: "eq", label: "igual a" },
  { value: "neq", label: "diferente de" },
  { value: "in", label: "esta em" },
  { value: "contains", label: "contem" },
  { value: "gte", label: "maior ou igual" },
  { value: "lte", label: "menor ou igual" },
  { value: "gt", label: "maior que" },
  { value: "lt", label: "menor que" },
];

const box: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #d7d9dc",
  borderRadius: 12,
  padding: 16,
  width: 320,
  fontFamily: "system-ui",
  fontSize: 13,
  boxShadow: "0 1px 4px rgba(0,0,0,.08)",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #d7d9dc",
  borderRadius: 6,
  fontSize: 13,
};
const row: React.CSSProperties = { display: "flex", gap: 6, marginBottom: 6 };
// Aplicado a todos os controles: nao arrastar o no ao interagir.
const NODRAG = "nodrag nowheel";

// ---- Trigger (SE) ----
export function TriggerNode({ data }: NodeProps) {
  const trigger = data.trigger as Trigger;
  const onChange = data.onChange as (t: Trigger) => void;

  const update = (patch: Partial<Trigger>) => onChange({ ...trigger, ...patch });
  const updateCond = (i: number, patch: Partial<Condition>) => {
    const conditions = trigger.conditions.map((c, idx) =>
      idx === i ? { ...c, ...patch } : c,
    );
    update({ conditions });
  };
  const removeCond = (i: number) =>
    update({ conditions: trigger.conditions.filter((_, idx) => idx !== i) });

  return (
    <div className="nowheel" style={{ ...box, borderColor: "#3483fa" }}>
      <strong style={{ color: "#3483fa" }}>SE — Gatilho</strong>
      <div style={{ ...row, marginTop: 8 }}>
        <select
          className={NODRAG}
          style={input}
          value={trigger.event}
          onChange={(e) => update({ event: e.target.value as Trigger["event"] })}
        >
          <option value="order_paid">Pedido pago</option>
          <option value="order_created">Pedido criado</option>
        </select>
        <select
          className={NODRAG}
          style={{ ...input, width: 110 }}
          value={trigger.match}
          onChange={(e) => update({ match: e.target.value as Trigger["match"] })}
        >
          <option value="all">todas</option>
          <option value="any">qualquer</option>
        </select>
      </div>

      {trigger.conditions.length === 0 && (
        <p style={{ color: "#888", margin: "4px 0" }}>
          Sem condições: aplica a todos os pedidos.
        </p>
      )}

      {trigger.conditions.map((c, i) => (
        <div key={i} style={{ ...row, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className={NODRAG}
            style={{ ...input, flex: 1 }}
            value={c.field}
            onChange={(e) => updateCond(i, { field: e.target.value as ConditionField })}
          >
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            className={NODRAG}
            style={{ ...input, width: 120 }}
            value={c.op}
            onChange={(e) => updateCond(i, { op: e.target.value as ConditionOp })}
          >
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            className={NODRAG}
            style={{ ...input, flex: 1 }}
            value={String(c.value)}
            placeholder="valor"
            onChange={(e) => updateCond(i, { value: e.target.value })}
          />
          <button
            className={NODRAG}
            onClick={() => removeCond(i)}
            title="Remover condição"
            style={{ border: "none", background: "none", cursor: "pointer", color: "#c00", fontSize: 16 }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className={NODRAG}
        style={{ ...input, cursor: "pointer", background: "#f5f6f7" }}
        onClick={() =>
          update({
            conditions: [
              ...trigger.conditions,
              { field: "item.sku", op: "eq", value: "" },
            ],
          })
        }
      >
        + condicao
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// ---- Step (ENTAO) ----
export function StepNode({ data }: NodeProps) {
  const step = data.step as Step;
  const onChange = data.onChange as (s: Step) => void;
  const onRemove = data.onRemove as () => void;

  const update = (patch: Partial<Step>) => onChange({ ...step, ...patch });

  return (
    <div className="nowheel" style={{ ...box, borderColor: "#00a650" }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ color: "#00a650" }}>ENTAO — Acao</strong>
        <button
          className={NODRAG}
          onClick={onRemove}
          style={{ border: "none", background: "none", cursor: "pointer", color: "#999" }}
        >
          remover
        </button>
      </div>

      <div style={{ ...row, marginTop: 8 }}>
        <span style={{ alignSelf: "center" }}>Apos</span>
        <input
          type="number"
          min={0}
          className={NODRAG}
          style={{ ...input, width: 70 }}
          value={step.delay.value}
          // Evita que a rolagem do mouse incremente o numero (bug em canvas).
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) =>
            update({ delay: { ...step.delay, value: Number(e.target.value) } })
          }
        />
        <select
          className={NODRAG}
          style={{ ...input, width: 110 }}
          value={step.delay.unit}
          onChange={(e) =>
            update({ delay: { ...step.delay, unit: e.target.value as Step["delay"]["unit"] } })
          }
        >
          <option value="minutes">minutos</option>
          <option value="hours">horas</option>
          <option value="days">dias</option>
        </select>
      </div>

      <select
        className={NODRAG}
        style={{ ...input, marginBottom: 6 }}
        value={step.action}
        onChange={(e) => update({ action: e.target.value as Step["action"] })}
      >
        <option value="email">Enviar e-mail</option>
        <option value="whatsapp">Enviar WhatsApp</option>
        <option value="tag">Adicionar tag</option>
        <option value="webhook">Acionar webhook</option>
        <option value="task">Criar tarefa</option>
      </select>

      <input
        className={NODRAG}
        style={input}
        placeholder="Prompt de IA (opcional) — gera o conteudo"
        value={step.aiPrompt ?? ""}
        onChange={(e) => update({ aiPrompt: e.target.value })}
      />
    </div>
  );
}

export const nodeTypes = { trigger: TriggerNode, step: StepNode };
