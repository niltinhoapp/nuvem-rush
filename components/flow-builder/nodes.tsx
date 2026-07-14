"use client";
// Nos customizados do construtor: TriggerNode (SE) e StepNode (ENTAO).
// Estilizados com Nimbus DS para ficar consistente com o resto do app.
// Edicao inline e propagada via callbacks guardados em node.data.
// Classes nodrag/nowheel: evitam que interagir com os campos arraste o no
// ou que a rolagem do mouse de zoom no canvas (ou incremente o input number).
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Text, Input, Select, Button, IconButton, Icon } from "@nimbus-ds/components";
import {
  LightningBoltIcon,
  TrashIcon,
  PlusCircleIcon,
  MailIcon,
  WhatsappIcon,
  TagIcon,
  LinkIcon,
  ChecklistIcon,
  MagicWandIcon,
} from "@nimbus-ds/icons";
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

const ACTIONS: { value: Step["action"]; label: string }[] = [
  { value: "email", label: "Enviar e-mail" },
  { value: "whatsapp", label: "Enviar WhatsApp" },
  { value: "tag", label: "Adicionar tag" },
  { value: "webhook", label: "Acionar webhook" },
  { value: "task", label: "Criar tarefa" },
];

const ACTION_ICON: Record<Step["action"], React.ReactNode> = {
  email: <MailIcon size={18} />,
  whatsapp: <WhatsappIcon size={18} />,
  tag: <TagIcon size={18} />,
  webhook: <LinkIcon size={18} />,
  task: <ChecklistIcon size={18} />,
};

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
    <Box
      className="nowheel"
      backgroundColor="neutral-background"
      borderColor="primary-interactive"
      borderWidth="2"
      borderStyle="solid"
      borderRadius="3"
      boxShadow="2"
      padding="4"
      width="360px"
      display="flex"
      flexDirection="column"
      gap="3"
    >
      <Box display="flex" alignItems="center" gap="2">
        <Icon source={<LightningBoltIcon size={18} />} color="primary-interactive" />
        <Text fontWeight="bold" color="primary-interactive">
          SE — Gatilho
        </Text>
      </Box>

      <Box display="flex" gap="2">
        <Select
          className={NODRAG}
          name="trigger-event"
          id="trigger-event"
          value={trigger.event}
          onChange={(e) => update({ event: e.target.value as Trigger["event"] })}
        >
          <Select.Option value="order_paid" label="Pedido pago" />
          <Select.Option value="order_created" label="Pedido criado" />
        </Select>
        <Select
          className={NODRAG}
          name="trigger-match"
          id="trigger-match"
          value={trigger.match}
          onChange={(e) => update({ match: e.target.value as Trigger["match"] })}
        >
          <Select.Option value="all" label="todas as condições" />
          <Select.Option value="any" label="qualquer condição" />
        </Select>
      </Box>

      {trigger.conditions.length === 0 && (
        <Text fontSize="caption" color="neutral-textLow">
          Sem condições: aplica a todos os pedidos.
        </Text>
      )}

      {trigger.conditions.map((c, i) => (
        <Box key={i} display="flex" flexWrap="wrap" alignItems="center" gap="1">
          <Select
            className={NODRAG}
            name={`cond-field-${i}`}
            id={`cond-field-${i}`}
            value={c.field}
            onChange={(e) => updateCond(i, { field: e.target.value as ConditionField })}
          >
            {FIELDS.map((f) => (
              <Select.Option key={f.value} value={f.value} label={f.label} />
            ))}
          </Select>
          <Select
            className={NODRAG}
            name={`cond-op-${i}`}
            id={`cond-op-${i}`}
            value={c.op}
            onChange={(e) => updateCond(i, { op: e.target.value as ConditionOp })}
          >
            {OPS.map((o) => (
              <Select.Option key={o.value} value={o.value} label={o.label} />
            ))}
          </Select>
          <Input
            className={NODRAG}
            value={String(c.value)}
            placeholder="valor"
            onChange={(e) => updateCond(i, { value: e.target.value })}
          />
          <IconButton
            className={NODRAG}
            source={<TrashIcon size={16} />}
            color="danger-textLow"
            onClick={() => removeCond(i)}
            aria-label="Remover condição"
          />
        </Box>
      ))}

      <Button
        appearance="neutral"
        size="small"
        className={NODRAG}
        onClick={() =>
          update({
            conditions: [
              ...trigger.conditions,
              { field: "item.sku", op: "eq", value: "" },
            ],
          })
        }
      >
        <Icon source={<PlusCircleIcon size={16} />} color="currentColor" />
        Condição
      </Button>

      <Handle type="source" position={Position.Bottom} />
    </Box>
  );
}

// ---- Step (ENTAO) ----
export function StepNode({ data }: NodeProps) {
  const step = data.step as Step;
  const onChange = data.onChange as (s: Step) => void;
  const onRemove = data.onRemove as () => void;

  const update = (patch: Partial<Step>) => onChange({ ...step, ...patch });

  return (
    <Box
      className="nowheel"
      backgroundColor="neutral-background"
      borderColor="success-interactive"
      borderWidth="2"
      borderStyle="solid"
      borderRadius="3"
      boxShadow="2"
      padding="4"
      width="340px"
      display="flex"
      flexDirection="column"
      gap="3"
    >
      <Handle type="target" position={Position.Top} />

      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap="2">
          <Icon source={ACTION_ICON[step.action]} color="success-interactive" />
          <Text fontWeight="bold" color="success-interactive">
            ENTÃO — Ação
          </Text>
        </Box>
        <IconButton
          className={NODRAG}
          source={<TrashIcon size={16} />}
          color="neutral-textLow"
          onClick={onRemove}
          aria-label="Remover ação"
        />
      </Box>

      <Box display="flex" alignItems="center" gap="2">
        <Text fontSize="caption" color="neutral-textLow">
          Após
        </Text>
        <Input
          type="number"
          min={0}
          className={NODRAG}
          width="70px"
          value={step.delay.value}
          // Evita que a rolagem do mouse incremente o numero (bug em canvas).
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) =>
            update({ delay: { ...step.delay, value: Number(e.target.value) } })
          }
        />
        <Select
          className={NODRAG}
          name="delay-unit"
          id="delay-unit"
          value={step.delay.unit}
          onChange={(e) =>
            update({ delay: { ...step.delay, unit: e.target.value as Step["delay"]["unit"] } })
          }
        >
          <Select.Option value="minutes" label="minutos" />
          <Select.Option value="hours" label="horas" />
          <Select.Option value="days" label="dias" />
        </Select>
      </Box>

      <Select
        className={NODRAG}
        name="step-action"
        id="step-action"
        value={step.action}
        onChange={(e) => update({ action: e.target.value as Step["action"] })}
      >
        {ACTIONS.map((a) => (
          <Select.Option key={a.value} value={a.value} label={a.label} />
        ))}
      </Select>

      <Box display="flex" flexDirection="column" gap="1">
        <Box display="flex" alignItems="center" gap="1">
          <Icon source={<MagicWandIcon size={14} />} color="ai-generative" />
          <Text fontSize="caption" color="neutral-textLow">
            Prompt de IA (opcional) — gera o conteúdo automaticamente
          </Text>
        </Box>
        <Input
          className={NODRAG}
          placeholder="Ex.: agradeça a compra e sugira produtos relacionados"
          value={step.aiPrompt ?? ""}
          onChange={(e) => update({ aiPrompt: e.target.value })}
        />
      </Box>
    </Box>
  );
}

export const nodeTypes = { trigger: TriggerNode, step: StepNode };
