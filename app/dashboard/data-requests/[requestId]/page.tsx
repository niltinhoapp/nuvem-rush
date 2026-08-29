"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Box, Button, Card, Icon, Spinner, Text, Title } from "@nimbus-ds/components";
import { ExclamationTriangleIcon } from "@nimbus-ds/icons";
import { ErrorBoundary } from "@tiendanube/nexo";
import { getNexo, initNexo, sessionToken } from "@/lib/nexo";
import { downloadDataRequestJson } from "@/lib/lgpd/dataRequestDownload.client";
import type {
  DataRequestCart,
  DataRequestContact,
  DataRequestEnrollment,
  DataRequestExport,
  DataRequestOrder,
  MessagingSummary,
} from "@/lib/lgpd/dataRequest";

type DeliveryPayload = {
  requestId: string;
  delivery: {
    method: "dashboard";
    delivered: true;
    deliveredAt: number;
    accessCount: number;
  };
  data: DataRequestExport;
};

type DetailState =
  | { status: "loading" }
  | { status: "ready"; payload: DeliveryPayload }
  | { status: "auth-error" }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "error" };

function formatDate(value: number | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isDeliveryPayload(value: unknown): value is DeliveryPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  return typeof payload.requestId === "string"
    && Boolean(data)
    && data?.requestId === payload.requestId
    && (data?.contact === null || typeof data?.contact === "object")
    && Array.isArray(data?.orders)
    && Array.isArray(data?.carts)
    && Array.isArray(data?.enrollments)
    && Array.isArray(data?.messagingSummary);
}

async function fetchDetail(requestId: string): Promise<{
  nexo: ReturnType<typeof getNexo>;
  state: DetailState;
}> {
  const nexo = await initNexo();
  const token = await sessionToken();
  const response = await fetch(
    `/api/dashboard/data-requests/${encodeURIComponent(requestId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (response.status === 401) return { nexo, state: { status: "auth-error" } };
  if (response.status === 404) return { nexo, state: { status: "not-found" } };
  if (response.status === 409) return { nexo, state: { status: "unavailable" } };
  if (!response.ok) throw new Error("data_request_detail_failed");
  const payload: unknown = await response.json();
  if (!isDeliveryPayload(payload)) throw new Error("data_request_detail_invalid");
  return { nexo, state: { status: "ready", payload } };
}

export default function DataRequestDetailPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [nexo, setNexo] = useState<ReturnType<typeof getNexo> | null>(null);

  useEffect(() => {
    let current = true;
    void fetchDetail(requestId)
      .then((result) => {
        if (!current) return;
        setNexo(result.nexo);
        setState(result.state);
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => { current = false; };
  }, [requestId]);

  const retry = () => {
    setState({ status: "loading" });
    void fetchDetail(requestId)
      .then((result) => {
        setNexo(result.nexo);
        setState(result.state);
      })
      .catch(() => setState({ status: "error" }));
  };

  const content = (
    <Box padding="6" display="flex" flexDirection="column" gap="6">
      <Box display="flex" justifyContent="space-between" alignItems="center" gap="4">
        <Box display="flex" flexDirection="column" gap="1">
          <Title as="h1" fontSize="5">Relatório de dados</Title>
          <Text color="neutral-textLow">
            Dados ativos associados ao titular no momento da consulta.
          </Text>
        </Box>
        <Button as="a" href="/dashboard/data-requests">Voltar</Button>
      </Box>
      <DataRequestDetailState state={state} onRetry={retry} />
    </Box>
  );

  return nexo ? <ErrorBoundary nexo={nexo}>{content}</ErrorBoundary> : content;
}

export function DataRequestDetailState({
  state,
  onRetry,
}: {
  state: DetailState;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <Box display="flex" justifyContent="center" padding="10">
        <Spinner size="large" />
      </Box>
    );
  }
  if (state.status === "auth-error") {
    return <DetailError message="Não foi possível validar sua sessão no admin da Nuvemshop." onRetry={onRetry} />;
  }
  if (state.status === "not-found") {
    return <DetailError message="Solicitação não encontrada." onRetry={onRetry} />;
  }
  if (state.status === "unavailable") {
    return (
      <DetailError
        message="Esta loja está com o processamento de dados temporariamente indisponível."
        onRetry={onRetry}
      />
    );
  }
  if (state.status === "error") {
    return <DetailError message="Não foi possível carregar este relatório." onRetry={onRetry} />;
  }
  return <DataRequestReport payload={state.payload} />;
}

export function DataRequestReport({ payload }: { payload: DeliveryPayload }) {
  const data = payload.data;
  return (
    <Box display="flex" flexDirection="column" gap="4">
      <Card padding="none">
        <Card.Body padding="base">
          <Box display="flex" justifyContent="space-between" alignItems="center" gap="4">
            <Box display="flex" flexDirection="column" gap="1">
              <Text fontWeight="bold">Relatório disponível</Text>
              <Text fontSize="caption" color="neutral-textLow">
                Consultado em {formatDate(data.generatedAt)}
              </Text>
            </Box>
            <Button
              appearance="primary"
              onClick={() => downloadDataRequestJson(payload.requestId, data)}
            >
              Baixar JSON
            </Button>
          </Box>
        </Card.Body>
      </Card>

      <Card padding="none">
        <Card.Body padding="base">
          <Text color="neutral-textLow">
            Este relatório reflete os dados ativos no momento desta consulta. Registros anteriores
            podem ter sido removidos ou anonimizados em atendimento a solicitações de exclusão (LGPD).
          </Text>
        </Card.Body>
      </Card>

      {data.contact ? <ContactSection contact={data.contact} /> : (
        <Card padding="none">
          <Card.Body padding="base">
            <Text>Não há dados ativos deste titular no momento da consulta.</Text>
          </Card.Body>
        </Card>
      )}
      <OrdersSection orders={data.orders} />
      <CartsSection carts={data.carts} />
      <EnrollmentsSection enrollments={data.enrollments} />
      <MessagingSection rows={data.messagingSummary} />
    </Box>
  );
}

function ContactSection({ contact }: { contact: DataRequestContact }) {
  return (
    <Section title="Contato">
      <Field label="Nome" value={contact.name ?? "Não informado"} />
      <Field label="E-mail" value={contact.email ?? "Não informado"} />
      <Field label="Telefone" value={contact.phone ?? "Não informado"} />
      <Field label="Tags" value={contact.tags.length ? contact.tags.join(", ") : "Nenhuma"} />
      <Field label="Quantidade de pedidos" value={String(contact.ordersCount)} />
      <Field label="Total gasto" value={formatMoney(contact.totalSpent)} />
      <Field label="Opt-out" value={contact.optOut ? "Sim" : "Não"} />
      <Field label="Último pedido" value={formatDate(contact.lastOrderAt)} />
    </Section>
  );
}

function OrdersSection({ orders }: { orders: DataRequestOrder[] }) {
  return (
    <Section title={`Pedidos (${orders.length})`}>
      {orders.length === 0 ? <Text color="neutral-textLow">Nenhum pedido ativo.</Text> : orders.map((order, index) => {
        const trackingUrl = safeHttpUrl(order.trackingUrl);
        return (
          <RecordCard key={order.orderId} title={`Pedido ${index + 1}`}>
            <Field label="Total" value={formatMoney(order.total)} />
            <Field label="Status" value={order.status} />
            <Field label="Envio" value={order.shippingStatus ?? "Não informado"} />
            <Field label="Código de rastreio" value={order.trackingCode ?? "Não informado"} />
            <Text fontSize="caption" color="neutral-textLow">Itens</Text>
            {order.items.length === 0 ? <Text>Nenhum item ativo.</Text> : order.items.map((item, itemIndex) => (
              <Text key={`${order.orderId}-${itemIndex}`}>
                {item.qty}x {item.sku ?? item.brand ?? "Item"} — {formatMoney(item.price)}
              </Text>
            ))}
            {trackingUrl ? <Button as="a" href={trackingUrl} target="_blank" rel="noreferrer">Abrir rastreio</Button> : null}
          </RecordCard>
        );
      })}
    </Section>
  );
}

function CartsSection({ carts }: { carts: DataRequestCart[] }) {
  return (
    <Section title={`Carrinhos (${carts.length})`}>
      {carts.length === 0 ? <Text color="neutral-textLow">Nenhum carrinho ativo.</Text> : carts.map((cart, index) => {
        const recoveryUrl = safeHttpUrl(cart.recoveryUrl);
        return (
          <RecordCard key={cart.cartId} title={`Carrinho ${index + 1}`}>
            <Field label="Total" value={formatMoney(cart.total)} />
            <Field label="Status" value={cart.status} />
            <Field label="Criado em" value={formatDate(cart.createdAt)} />
            <Field label="Abandonado em" value={formatDate(cart.abandonedAt)} />
            <Text fontSize="caption" color="neutral-textLow">Itens</Text>
            {cart.items.length === 0 ? <Text>Nenhum item ativo.</Text> : cart.items.map((item, itemIndex) => (
              <Text key={`${cart.cartId}-${itemIndex}`}>
                {item.qty}x {item.sku ?? item.brand ?? "Item"} — {formatMoney(item.price)}
              </Text>
            ))}
            {recoveryUrl ? <Button as="a" href={recoveryUrl} target="_blank" rel="noreferrer">Abrir recuperação</Button> : null}
          </RecordCard>
        );
      })}
    </Section>
  );
}

function EnrollmentsSection({ enrollments }: { enrollments: DataRequestEnrollment[] }) {
  return (
    <Section title={`Automações (${enrollments.length})`}>
      {enrollments.length === 0 ? <Text color="neutral-textLow">Nenhuma automação ativa.</Text> : enrollments.map((enrollment, index) => (
        <RecordCard key={enrollment.enrollmentId} title={`Automação ${index + 1}`}>
          <Field label="Status" value={enrollment.status} />
          <Field label="Iniciada em" value={formatDate(enrollment.startedAt)} />
          <Field
            label="Origem"
            value={enrollment.orderId ? "Pedido" : enrollment.cartId ? "Carrinho" : "Não informada"}
          />
        </RecordCard>
      ))}
    </Section>
  );
}

function MessagingSection({ rows }: { rows: MessagingSummary[] }) {
  return (
    <Section title="Resumo de mensagens">
      {rows.length === 0 ? <Text color="neutral-textLow">Nenhuma mensagem relacionada.</Text> : rows.map((row) => (
        <RecordCard key={row.channel} title={row.channel === "whatsapp" ? "WhatsApp" : row.channel === "email" ? "E-mail" : row.channel}>
          <Field label="Enviadas" value={String(row.sent)} />
          <Field label="Agendadas" value={String(row.scheduled)} />
          <Field label="Falhas" value={String(row.failed)} />
          <Field label="Canceladas" value={String(row.cancelled)} />
        </RecordCard>
      ))}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" gap="3">
          <Title as="h2" fontSize="3">{title}</Title>
          {children}
        </Box>
      </Card.Body>
    </Card>
  );
}

function RecordCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="2" padding="4" backgroundColor="neutral-surface">
      <Text fontWeight="bold">{title}</Text>
      {children}
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box display="flex" gap="2" alignItems="center">
      <Text fontSize="caption" color="neutral-textLow">{label}:</Text>
      <Text>{value}</Text>
    </Box>
  );
}

function DetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card padding="none">
      <Card.Body padding="base">
        <Box display="flex" flexDirection="column" alignItems="center" gap="4" padding="6" textAlign="center">
          <Icon source={<ExclamationTriangleIcon size={32} />} color="danger-textLow" />
          <Title as="h2" fontSize="3">Ocorreu um erro</Title>
          <Text color="neutral-textLow">{message}</Text>
          <Button appearance="primary" onClick={onRetry}>Tentar novamente</Button>
        </Box>
      </Card.Body>
    </Card>
  );
}
