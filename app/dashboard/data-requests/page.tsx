"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Box, Button, Card, Icon, Spinner, Tag, Text, Title } from "@nimbus-ds/components";
import { ExclamationTriangleIcon } from "@nimbus-ds/icons";
import { ErrorBoundary } from "@tiendanube/nexo";
import { getNexo, initNexo, sessionToken } from "@/lib/nexo";
import type { DataRequestDashboardItem } from "@/lib/lgpd/dataRequest";

type PageState =
  | { status: "loading" }
  | { status: "ready"; requests: DataRequestDashboardItem[] }
  | { status: "auth-error" }
  | { status: "error" };

const COMPILE_STATUS = {
  pending: { label: "Pendente", appearance: "neutral" },
  processing: { label: "Processando", appearance: "warning" },
  completed: { label: "Concluída", appearance: "success" },
  failed: { label: "Falhou", appearance: "danger" },
} as const;

const DELIVERY_STATUS = {
  pending: { label: "Aguardando consulta", appearance: "neutral" },
  delivered: { label: "Consultada", appearance: "success" },
} as const;

function formatDate(value: number | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function isDashboardItem(value: unknown): value is DataRequestDashboardItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.requestId === "string"
    && typeof item.receivedAt === "number"
    && ["pending", "processing", "completed", "failed"].includes(String(item.compileStatus))
    && ["pending", "delivered"].includes(String(item.deliveryStatus));
}

async function fetchRequests(): Promise<{
  nexo: ReturnType<typeof getNexo>;
  state: PageState;
}> {
  const nexo = await initNexo();
  const token = await sessionToken();
  const response = await fetch("/api/dashboard/data-requests", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) return { nexo, state: { status: "auth-error" } };
  if (!response.ok) throw new Error("data_request_list_failed");
  const body = await response.json() as { requests?: unknown };
  const requests = Array.isArray(body.requests)
    ? body.requests.filter(isDashboardItem)
    : [];
  return { nexo, state: { status: "ready", requests } };
}

export default function DataRequestsPage() {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [nexo, setNexo] = useState<ReturnType<typeof getNexo> | null>(null);

  useEffect(() => {
    let current = true;
    void fetchRequests()
      .then((result) => {
        if (!current) return;
        setNexo(result.nexo);
        setState(result.state);
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => { current = false; };
  }, []);

  const retry = () => {
    setState({ status: "loading" });
    void fetchRequests()
      .then((result) => {
        setNexo(result.nexo);
        setState(result.state);
      })
      .catch(() => setState({ status: "error" }));
  };

  const content = (
    <Box padding="6" display="flex" flexDirection="column" gap="6">
      <Box display="flex" flexDirection="column" gap="1">
        <Title as="h1" fontSize="5">Solicitações de dados</Title>
        <Text color="neutral-textLow">
          Relatórios solicitados por clientes pelos processos de privacidade da Nuvemshop.
        </Text>
      </Box>
      <DataRequestListState state={state} onRetry={retry} />
    </Box>
  );

  return nexo ? <ErrorBoundary nexo={nexo}>{content}</ErrorBoundary> : content;
}

export function DataRequestListState({
  state,
  onRetry,
}: {
  state: PageState;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return <CenteredState icon={<Spinner size="large" />} title="Carregando solicitações..." />;
  }
  if (state.status === "auth-error") {
    return (
      <ErrorState
        description="Não foi possível validar sua sessão no admin da Nuvemshop."
        onRetry={onRetry}
      />
    );
  }
  if (state.status === "error") {
    return (
      <ErrorState
        description="Não foi possível carregar as solicitações agora."
        onRetry={onRetry}
      />
    );
  }
  if (state.requests.length === 0) {
    return (
      <Card padding="none">
        <Card.Body padding="base">
          <CenteredState
            icon={<Text fontSize="highlight">Privacidade</Text>}
            title="Nenhuma solicitação de dados recebida ainda."
          />
        </Card.Body>
      </Card>
    );
  }
  return (
    <Box display="flex" flexDirection="column" gap="3">
      {state.requests.map((request) => {
        const compile = COMPILE_STATUS[request.compileStatus];
        const delivery = DELIVERY_STATUS[request.deliveryStatus];
        return (
          <Card padding="none" key={request.requestId}>
            <Card.Body padding="base">
              <Box display="flex" justifyContent="space-between" alignItems="center" gap="4">
                <Box display="flex" flexDirection="column" gap="2">
                  <Text fontWeight="bold">Recebida em {formatDate(request.receivedAt)}</Text>
                  <Box display="flex" gap="2" alignItems="center">
                    <Tag appearance={compile.appearance}>Compilação: {compile.label}</Tag>
                    <Tag appearance={delivery.appearance}>Entrega: {delivery.label}</Tag>
                  </Box>
                  {request.deliveredAt ? (
                    <Text fontSize="caption" color="neutral-textLow">
                      Entregue em {formatDate(request.deliveredAt)}
                    </Text>
                  ) : null}
                </Box>
                <Button as="a" href={`/dashboard/data-requests/${request.requestId}`}>
                  Ver solicitação
                </Button>
              </Box>
            </Card.Body>
          </Card>
        );
      })}
    </Box>
  );
}

function CenteredState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap="3" padding="8">
      {icon}
      <Text color="neutral-textLow">{title}</Text>
    </Box>
  );
}

function ErrorState({ description, onRetry }: { description: string; onRetry: () => void }) {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" alignItems="center" gap="4" padding="6" textAlign="center">
          <Icon source={<ExclamationTriangleIcon size={32} />} color="danger-textLow" />
          <Title as="h2" fontSize="3">Ocorreu um erro</Title>
          <Text color="neutral-textLow">{description}</Text>
          <Button appearance="primary" onClick={onRetry}>Tentar novamente</Button>
        </Box>
      </Card.Body>
    </Card>
  );
}
