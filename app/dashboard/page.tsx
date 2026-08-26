// Tela inicial do app incorporado (roda dentro do iframe do admin).
// Construida com o Nimbus Design System, seguindo os templates de estado
// vazio/inicial e de erro exigidos na homologacao da Nuvemshop:
// https://dev.nuvemshop.com.br/docs/homologation/checklist
"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Box, Title, Text, Button, Card, Tag, Icon, Spinner, Input } from "@nimbus-ds/components";
import {
  MailIcon,
  WhatsappIcon,
  LightningBoltIcon,
  ExclamationTriangleIcon,
  PlusCircleIcon,
  EditIcon,
} from "@nimbus-ds/icons";
import { ErrorBoundary } from "@tiendanube/nexo";
import { initNexo, getNexo, sessionToken } from "@/lib/nexo";
import { templateStatusLabel } from "@/lib/whatsapp/templateStatus";
import { WHATSAPP_TEMPLATE_CATALOG_KEYS, getCatalogTemplate, type TemplateCatalogKey } from "@/lib/whatsapp/catalog";
import type { CommercialState } from "@/lib/billing/policy";
import { PLANS } from "@/lib/plans";
import type { Flow } from "@/types";

type ConnectionStatus = "loading" | "ready" | "error";

const STATUS_TAG: Record<Flow["status"], { label: string; appearance: "success" | "warning" | "neutral" }> = {
  active: { label: "Ativo", appearance: "success" },
  paused: { label: "Pausado", appearance: "warning" },
  draft: { label: "Rascunho", appearance: "neutral" },
};

const ACTION_LABEL: Record<string, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  tag: "Tag",
  webhook: "Webhook",
  task: "Tarefa",
};

const TRIGGER_LABEL: Record<Flow["trigger"]["event"], string> = {
  order_paid: "Pedido pago",
  order_created: "Pedido criado",
  order_fulfilled: "Pedido enviado",
  cart_abandoned: "Carrinho abandonado",
};

export default function DashboardPage() {
  const [connection, setConnection] = useState<ConnectionStatus>("loading");
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [flowsFailed, setFlowsFailed] = useState(false);
  const [wa, setWa] = useState<{
    connected: boolean;
    phoneNumberId: string | null;
    templates: Partial<Record<TemplateCatalogKey, { name: string; language: string; status: string }>>;
  } | null>(null);
  const [testState, setTestState] = useState<{ sending: boolean; msg: string }>({
    sending: false,
    msg: "",
  });
  const [billing, setBilling] = useState<{ state: CommercialState } | null>(null);
  // So existe no cliente: getNexo() usa `window` por baixo, e nao pode ser
  // chamado durante o prerender/SSR da pagina (mesmo com "use client").
  const [nexo, setNexo] = useState<ReturnType<typeof getNexo> | null>(null);

  const loadFlows = () => {
    setFlows(null);
    setFlowsFailed(false);
    sessionToken()
      .then(async (token) => {
        const r = await fetch("/api/flows", { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        setFlows(Array.isArray(data.flows) ? data.flows : []);
      })
      .catch((e) => {
        console.error("Falha ao carregar fluxos:", e);
        setFlowsFailed(true);
      });
  };

  const loadBillingStatus = () => {
    sessionToken()
      .then(async (token) => {
        const r = await fetch("/api/billing/status", { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        setBilling({ state: data.state });
      })
      .catch((e) => console.error("Falha ao checar status comercial:", e));
  };

  const loadWhatsappStatus = () => {
    sessionToken()
      .then(async (token) => {
        const r = await fetch("/api/whatsapp/connect", { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setWa({
          connected: !!data.connected,
          phoneNumberId: data.phoneNumberId ?? null,
          templates: data.templates && typeof data.templates === "object" ? data.templates : {},
        });
      })
      .catch((e) => console.error("Falha ao checar status do WhatsApp:", e));
  };

  // Abre /connect-whatsapp em nova aba (popups da Meta nao funcionam bem
  // dentro do iframe do admin), levando o session token na URL.
  const openConnectWhatsapp = async () => {
    const token = await sessionToken();
    window.open(`/connect-whatsapp?token=${encodeURIComponent(token)}`, "_blank");
  };

  // Envia uma mensagem de teste para o numero informado, para o lojista
  // validar a conexao sem precisar esperar um pedido real.
  const sendTest = async (to: string) => {
    setTestState({ sending: true, msg: "" });
    try {
      const token = await sessionToken();
      const r = await fetch("/api/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to }),
      });
      const data = await r.json();
      setTestState({
        sending: false,
        msg: r.ok
          ? "Mensagem enviada! Confira seu WhatsApp."
          : `Falha: ${data.detail ?? data.error ?? "erro desconhecido"}`,
      });
    } catch (e) {
      setTestState({ sending: false, msg: `Falha: ${String(e)}` });
    }
  };

  useEffect(() => {
    initNexo()
      .then((instance) => {
        setNexo(instance);
        setConnection("ready");
        loadFlows();
        loadWhatsappStatus();
        loadBillingStatus();
      })
      .catch((e) => {
        console.error("Nexo falhou:", e);
        setConnection("error");
      });
  }, []);

  const content = (
    <Box padding="6" display="flex" flexDirection="column" gap="6">
      <PageHeader />

      {connection === "ready" && billing && <BillingStatusCard billing={billing} />}

      {connection === "ready" && (
        <WhatsappStatusCard
          wa={wa}
          onConnect={openConnectWhatsapp}
          onRefresh={loadWhatsappStatus}
          onTest={sendTest}
          testState={testState}
        />
      )}

      {connection === "loading" && <CenteredState icon={<Spinner size="large" />} title="Conectando ao admin..." />}

      {connection === "error" && (
        <ErrorState
          description="Não foi possível conectar com o admin da Nuvemshop. Recarregue a página para tentar novamente."
          onRetry={() => window.location.reload()}
        />
      )}

      {connection === "ready" && flowsFailed && (
        <ErrorState
          description="Não foi possível carregar seus fluxos agora. Tente novamente em instantes."
          onRetry={loadFlows}
        />
      )}

      {connection === "ready" && !flowsFailed && flows === null && (
        <CenteredState icon={<Spinner size="large" />} title="Carregando seus fluxos..." />
      )}

      {connection === "ready" && !flowsFailed && flows !== null && flows.length === 0 && <EmptyState />}

      {connection === "ready" && !flowsFailed && flows !== null && flows.length > 0 && <FlowsList flows={flows} />}

      {connection === "ready" && <DataRequestsCard />}
    </Box>
  );

  return nexo ? <ErrorBoundary nexo={nexo}>{content}</ErrorBoundary> : content;
}

function PageHeader() {
  return (
    <Box display="flex" alignItems="center" gap="3">
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        backgroundColor="primary-surface"
        borderRadius="2"
        width="48px"
        height="48px"
      >
        <Icon source={<LightningBoltIcon size={24} />} color="primary-interactive" />
      </Box>
      <Box display="flex" flexDirection="column">
        <Title as="h1" fontSize="5">
          Nuvem Rush
        </Title>
        <Text color="neutral-textLow">Automações de e-mail e WhatsApp para o pós-venda</Text>
      </Box>
    </Box>
  );
}

// Card comercial (Billing V1 — Nuvemshop nativo): mostra se a Nuvemshop esta
// concedendo acesso agora. NAO afirma "assinatura em dia" nem mostra preco
// vinculado a um pagamento confirmado — nao ha, documentado, como distinguir
// "dentro do periodo gratis" de "pagando" (ver lib/billing/policy.ts). O
// periodo gratis (14 dias) e a cobranca em si sao geridos pela propria
// Nuvemshop; este card so reflete se ela esta liberando o uso.
function BillingStatusCard({
  billing,
}: {
  billing: { state: CommercialState };
}) {
  const { title, description, appearance } = (() => {
    switch (billing.state) {
      case "paid_active":
        return {
          title: "Acesso liberado",
          description: `Seu plano ${PLANS.essencial.label} está liberado pela Nuvemshop (período grátis ou assinatura em dia).`,
          appearance: "success" as const,
        };
      case "paid_inactive":
        return {
          title: "Acesso bloqueado pela Nuvemshop",
          description: "A Nuvemshop pausou o acesso deste app (pagamento pendente ou período grátis encerrado). Regularize pelo painel da Nuvemshop para retomar as automações.",
          appearance: "danger" as const,
        };
      case "billing_unknown":
      default:
        return {
          title: "Não foi possível confirmar seu acesso agora",
          description: "Estamos com uma instabilidade temporária para confirmar seu acesso. Isso não afeta automações já em andamento; tente novamente em alguns minutos.",
          appearance: "warning" as const,
        };
    }
  })();

  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" alignItems="center" justifyContent="space-between" gap="4">
          <Box display="flex" flexDirection="column" gap="1">
            <Text fontWeight="bold">{title}</Text>
            <Text fontSize="caption" color="neutral-textLow">{description}</Text>
          </Box>
          <Tag appearance={appearance}>{title}</Tag>
        </Box>
      </Card.Body>
    </Card>
  );
}

// Card de conexao do WhatsApp (Embedded Signup) + envio de mensagem de teste.
// O botao "Conectar" abre /connect-whatsapp em nova aba (o fluxo com a Meta
// nao roda dentro do iframe). O teste funciona mesmo antes de conectar,
// usando o numero global — util para o lojista validar o canal.
function WhatsappStatusCard({
  wa,
  onConnect,
  onRefresh,
  onTest,
  testState,
}: {
  wa: {
    connected: boolean;
    phoneNumberId: string | null;
    templates: Partial<Record<TemplateCatalogKey, { name: string; language: string; status: string }>>;
  } | null;
  onConnect: () => void;
  onRefresh: () => void;
  onTest: (to: string) => void;
  testState: { sending: boolean; msg: string };
}) {
  const [testTo, setTestTo] = useState("");
  const connected = !!wa?.connected;

  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" gap="4">
          <Box display="flex" alignItems="center" justifyContent="space-between" gap="4">
            <Box display="flex" alignItems="center" gap="3">
              <Icon
                source={<WhatsappIcon size={24} />}
                color={connected ? "success-interactive" : "neutral-textLow"}
              />
              <Box display="flex" flexDirection="column">
                <Text fontWeight="bold">
                  {connected ? "WhatsApp conectado" : "Conecte seu WhatsApp"}
                </Text>
                <Text fontSize="caption" color="neutral-textLow">
                  {connected
                    ? `Número: ${wa?.phoneNumberId}`
                    : "Conecte a conta oficial da Meta para enviar mensagens de pós-venda."}
                </Text>
              </Box>
            </Box>
            {connected ? (
              <Tag appearance="success">Conectado</Tag>
            ) : (
              <Box display="flex" gap="2">
                <Button onClick={onRefresh}>Atualizar</Button>
                <Button appearance="primary" onClick={onConnect}>
                  Conectar WhatsApp
                </Button>
              </Box>
            )}
          </Box>

          {connected && (
            <Box display="flex" flexDirection="column" gap="1">
              {WHATSAPP_TEMPLATE_CATALOG_KEYS.map((key) => {
                const catalog = getCatalogTemplate(key);
                const status = wa?.templates[key]?.status;
                return (
                  <Text key={key} fontSize="caption" color="neutral-textLow">
                    {catalog.label}: {templateStatusLabel(status)}
                  </Text>
                );
              })}
              <Text fontSize="caption" color="neutral-textLow">
                Cada automação só envia após a aprovação do respectivo template pela Meta.
              </Text>
            </Box>
          )}

          {/* Envio de teste: valida o canal sem precisar de um pedido real. */}
          <Box display="flex" flexDirection="column" gap="2">
            <Text fontSize="caption" color="neutral-textLow">
              Enviar mensagem de teste (com DDD, ex.: 14996807881)
            </Text>
            <Box display="flex" gap="2" alignItems="center">
              <Input
                placeholder="14996807881"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <Button
                appearance="primary"
                disabled={testState.sending || testTo.trim().length < 10}
                onClick={() => onTest(testTo)}
              >
                {testState.sending ? "Enviando..." : "Enviar teste"}
              </Button>
            </Box>
            {testState.msg && (
              <Text
                fontSize="caption"
                color={testState.msg.startsWith("Falha") ? "danger-textLow" : "success-textLow"}
              >
                {testState.msg}
              </Text>
            )}
          </Box>
        </Box>
      </Card.Body>
    </Card>
  );
}

function CenteredState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap="4"
      padding="10"
    >
      {icon}
      <Text color="neutral-textLow">{title}</Text>
    </Box>
  );
}

// Template "Error Page" (obrigatorio na homologacao): explica o problema,
// oferece um botao para tentar novamente e deixa claro que o erro e do app.
function ErrorState({ description, onRetry }: { description: string; onRetry: () => void }) {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" alignItems="center" gap="4" padding="6" textAlign="center">
          <Icon source={<ExclamationTriangleIcon size={32} />} color="danger-textLow" />
          <Box display="flex" flexDirection="column" gap="1">
            <Title as="h3" fontSize="3">
              Ocorreu um erro
            </Title>
            <Text color="neutral-textLow">{description}</Text>
          </Box>
          <Button appearance="primary" onClick={onRetry}>
            Tentar novamente
          </Button>
        </Box>
      </Card.Body>
    </Card>
  );
}

// Template "Empty/Initial State" (obrigatorio na homologacao): usado quando
// a loja ainda nao configurou nenhum fluxo.
function EmptyState() {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" alignItems="center" gap="4" padding="8" textAlign="center">
          <Box display="flex" gap="2">
            <Icon source={<MailIcon size={28} />} color="primary-interactive" />
            <Icon source={<WhatsappIcon size={28} />} color="success-interactive" />
          </Box>
          <Box display="flex" flexDirection="column" gap="1" maxWidth="440px">
            <Title as="h2" fontSize="4">
              Crie sua primeira automação
            </Title>
            <Text color="neutral-textLow">
              Monte regras do tipo SE (produto, SKU, categoria, marca ou valor) ENTÃO envie um e-mail ou
              WhatsApp automático depois de X dias. Ideal para pós-venda, recompra e avaliações.
            </Text>
          </Box>
          <Button appearance="primary" as="a" href="/dashboard/flows/new">
            <Icon source={<PlusCircleIcon size={16} />} color="currentColor" />
            Criar novo fluxo
          </Button>
        </Box>
      </Card.Body>
    </Card>
  );
}

function FlowsList({ flows }: { flows: Flow[] }) {
  return (
    <Box display="flex" flexDirection="column" gap="4">
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Title as="h2" fontSize="3">
          Seus fluxos ({flows.length})
        </Title>
        <Button appearance="primary" as="a" href="/dashboard/flows/new">
          <Icon source={<PlusCircleIcon size={16} />} color="currentColor" />
          Criar novo fluxo
        </Button>
      </Box>

      <Box display="flex" flexDirection="column" gap="2">
        {flows.map((flow) => (
          <FlowRow key={flow.flowId} flow={flow} />
        ))}
      </Box>
    </Box>
  );
}

function FlowRow({ flow }: { flow: Flow }) {
  const statusTag = STATUS_TAG[flow.status] ?? STATUS_TAG.draft;
  const actions = Array.from(new Set(flow.steps.map((s) => ACTION_LABEL[s.action] ?? s.action)));

  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" alignItems="center" justifyContent="space-between" gap="4">
          <Box display="flex" flexDirection="column" gap="1">
            <Box display="flex" alignItems="center" gap="2">
              <Text fontWeight="bold">{flow.name}</Text>
              <Tag appearance={statusTag.appearance}>{statusTag.label}</Tag>
            </Box>
            <Text fontSize="caption" color="neutral-textLow">
              SE {TRIGGER_LABEL[flow.trigger.event] ?? flow.trigger.event}
              {actions.length > 0 ? ` · ENTÃO ${actions.join(", ")}` : ""}
            </Text>
            <Text fontSize="caption" color="neutral-textLow">
              {flow.stats.enrolled} contatos inscritos · {flow.stats.sent} mensagens enviadas
            </Text>
          </Box>
          <Button as="a" href={`/dashboard/flows/${flow.flowId}`}>
            <Icon source={<EditIcon size={16} />} color="currentColor" />
            Editar
          </Button>
        </Box>
      </Card.Body>
    </Card>
  );
}


function DataRequestsCard() {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" alignItems="center" justifyContent="space-between" gap="4">
          <Box display="flex" flexDirection="column" gap="1">
            <Title as="h2" fontSize="3">
              Privacidade - Solicitações de dados
            </Title>
            <Text color="neutral-textLow">
              Consulte os relatórios de dados solicitados por clientes pelos canais oficiais da Nuvemshop.
            </Text>
          </Box>
          <Button as="a" href="/dashboard/data-requests">
            Ver solicitações
          </Button>
        </Box>
      </Card.Body>
    </Card>
  );
}
