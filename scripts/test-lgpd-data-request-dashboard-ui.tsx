import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  appendUniqueRequests,
  DataRequestListState,
  LoadMoreState,
} from "../app/dashboard/data-requests/page";
import {
  DataRequestDetailState,
  DataRequestReport,
} from "../app/dashboard/data-requests/[requestId]/page";
import { downloadDataRequestJson } from "../lib/lgpd/dataRequestDownload.client";
import type { DataRequestExport } from "../lib/lgpd/dataRequest";

let passed = 0;
function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS  ${label}`);
  passed++;
}

const noop = () => undefined;
const requestId = "a".repeat(64);
const exported: DataRequestExport = {
  requestId,
  storeId: "store-a",
  generatedAt: 1_700_000_000_000,
  contact: {
    contactId: "opaque-contact",
    nsCustomerId: "customer-a",
    name: "Titular A",
    email: "titular-a@example.com",
    phone: "+55 11 90000-0001",
    tags: ["cliente"],
    ordersCount: 1,
    totalSpent: 125,
    optOut: false,
    lastOrderAt: 1_700_000_000_000,
  },
  orders: [{
    orderId: "order-a",
    nsOrderId: "ns-order-a",
    total: 125,
    items: [{ sku: "SKU-A", productId: null, categoryIds: [], brand: null, qty: 1, price: 125 }],
    status: "paid",
    paidAt: 1_700_000_000_000,
    fulfilledAt: null,
    shippingStatus: "pronto",
    trackingCode: null,
    trackingUrl: null,
  }],
  carts: [],
  enrollments: [{
    enrollmentId: "enrollment-a",
    flowId: "raw-flow-id-must-not-render",
    orderId: "order-a",
    status: "active",
    startedAt: 1_700_000_000_000,
  }],
  messagingSummary: [{ channel: "email", sent: 1, scheduled: 0, failed: 0, cancelled: 0 }],
};

const emptyList = renderToStaticMarkup(
  <DataRequestListState state={{ status: "ready", requests: [], nextCursor: null }} onRetry={noop} />,
);
check("D lista vazia renderiza empty state", emptyList.includes("Nenhuma solicitação de dados recebida ainda."));

const detail = renderToStaticMarkup(
  <DataRequestReport payload={{
    requestId,
    delivery: { method: "dashboard", delivered: true, deliveredAt: 1, accessCount: 1 },
    data: exported,
  }} />,
);
check("F detalhe 200 renderiza dados permitidos", detail.includes("Titular A")
  && detail.includes("Pedidos (1)")
  && detail.includes("Resumo de mensagens"));
check("F detalhe nao destaca flowId cru", !detail.includes("raw-flow-id-must-not-render"));
check("N detalhe nao inclui outro titular", !detail.includes("titular-b@example.com"));

const noContact = renderToStaticMarkup(
  <DataRequestReport payload={{
    requestId,
    delivery: { method: "dashboard", delivered: true, deliveredAt: 1, accessCount: 1 },
    data: { ...exported, contact: null, orders: [], enrollments: [], messagingSummary: [] },
  }} />,
);
check("G contact null renderiza estado sem dados ativos",
  noContact.includes("Não há dados ativos deste titular no momento da consulta."));

const authError = renderToStaticMarkup(
  <DataRequestDetailState state={{ status: "auth-error" }} onRetry={noop} />,
);
const notFound = renderToStaticMarkup(
  <DataRequestDetailState state={{ status: "not-found" }} onRetry={noop} />,
);
const unavailable = renderToStaticMarkup(
  <DataRequestDetailState state={{ status: "unavailable" }} onRetry={noop} />,
);
check("H detalhe 401 renderiza erro de autenticacao", authError.includes("validar sua sessão"));
check("H detalhe 404 renderiza estado correto", notFound.includes("Solicitação não encontrada."));
check("H detalhe 409 renderiza estado correto", unavailable.includes("temporariamente indisponível"));

const loadMore = renderToStaticMarkup(<LoadMoreState status="idle" onLoadMore={noop} />);
const loadMoreError = renderToStaticMarkup(<LoadMoreState status="error" onLoadMore={noop} />);
check("UI oferece Carregar mais sem infinite scroll", loadMore.includes("Carregar mais"));
check("UI mantem erro de paginacao inline com retry", loadMoreError.includes("Tente novamente")
  && loadMoreError.includes("Carregar mais"));
const deduped = appendUniqueRequests(
  [{ requestId: "1", receivedAt: 3, compileStatus: "completed", deliveryStatus: "pending" }],
  [
    { requestId: "1", receivedAt: 3, compileStatus: "completed", deliveryStatus: "pending" },
    { requestId: "2", receivedAt: 2, compileStatus: "completed", deliveryStatus: "pending" },
  ],
);
check("append defensivo preserva ordem e remove duplicata por requestId",
  deduped.map((item) => item.requestId).join(",") === "1,2");

async function testDownload() {
  let downloaded = "";
  let clicked = false;
  let revoked = false;
  const captured = { body: null as Promise<string> | null };
  const anchor = {
    href: "",
    download: "",
    style: { display: "" },
    click() { clicked = true; },
    remove() {},
  };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => anchor,
      body: { appendChild: () => undefined },
    },
  });
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) throw new Error("blob esperado");
    captured.body = blob.text();
    return "blob:test-only";
  };
  URL.revokeObjectURL = () => { revoked = true; };
  try {
    downloadDataRequestJson(requestId, exported);
    if (captured.body) downloaded = await captured.body;
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
  check("I download usa exatamente o export autorizado", downloaded === JSON.stringify(exported, null, 2));
  check("I download usa nome tecnico limitado", anchor.download === `nuvem-rush-data-request-${requestId.slice(0, 12)}.json`);
  check("I download local clica e revoga object URL", clicked && revoked);
}

async function main() {
  await testDownload();
  const dashboard = readFileSync(resolve("app/dashboard/page.tsx"), "utf8");
  const listPage = readFileSync(resolve("app/dashboard/data-requests/page.tsx"), "utf8");
  const detailPage = readFileSync(resolve("app/dashboard/data-requests/[requestId]/page.tsx"), "utf8");
  const listRoute = readFileSync(resolve("app/api/dashboard/data-requests/route.ts"), "utf8");
  const download = readFileSync(resolve("lib/lgpd/dataRequestDownload.client.ts"), "utf8");
  const firebaseConfig = JSON.parse(readFileSync(resolve("firebase.json"), "utf8")) as Record<string, any>;
  const indexesConfig = JSON.parse(readFileSync(resolve("firestore.indexes.json"), "utf8")) as Record<string, any>;
  const clientSources = `${listPage}\n${detailPage}\n${download}`;
  check("E dashboard principal contem card de Privacidade", dashboard.includes("Privacidade - Solicitações de dados")
    && dashboard.includes("/dashboard/data-requests"));
  check("M paginas usam sessao Nexo no Authorization", [listPage, detailPage].every((source) =>
    source.includes("initNexo()")
      && source.includes("sessionToken()")
      && source.includes("Authorization: `Bearer ${token}`")));
  check("A endpoint de lista usa somente sessao autenticada", listRoute.includes("resolveAuthenticatedStoreId(req)")
    && !listRoute.includes("resolveStoreId(req)")
    && !listRoute.includes("x-store-id")
    && !listRoute.includes('searchParams.get("storeId")')
    && listRoute.includes('searchParams.get("cursor")'));
  check("J nenhum localStorage/sessionStorage", !/localStorage|sessionStorage/.test(clientSources));
  check("K nenhum console na UI de dados", !/console\./.test(clientSources));
  check("L nenhuma URL publica, signed URL ou Storage", !/signedUrl|firebase\/storage|@vercel\/blob|storageBucket/.test(clientSources));
  const lgpdIndex = indexesConfig.indexes?.find((index: Record<string, unknown>) =>
    index.collectionGroup === "lgpd_requests");
  check("indice composto possui sintaxe e campos esperados",
    firebaseConfig.firestore?.indexes === "firestore.indexes.json"
      && firebaseConfig.firestore?.rules === "firestore.rules"
      && lgpdIndex?.queryScope === "COLLECTION"
      && JSON.stringify(lgpdIndex?.fields) === JSON.stringify([
        { fieldPath: "type", order: "ASCENDING" },
        { fieldPath: "receivedAt", order: "DESCENDING" },
      ])
      && Array.isArray(indexesConfig.fieldOverrides));
  console.log(`\n${passed} testes da UI LGPD dashboard passaram`);
}

main().catch((error: unknown) => {
  console.error("LGPD dashboard UI test failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
