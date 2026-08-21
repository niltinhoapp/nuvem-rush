import { NextRequest, NextResponse } from "next/server";
import { resolveAuthenticatedStoreId } from "@/lib/auth/session";
import {
  firestoreDataRequestRepository,
  type DataRequestDashboardListRepository,
} from "@/lib/lgpd/dataRequest.firestore";
import {
  decodeDataRequestCursor,
  encodeDataRequestCursor,
  InvalidDataRequestCursorError,
} from "@/lib/lgpd/dataRequestPagination";

const DASHBOARD_REQUEST_LIMIT = 50;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

type DataRequestListDependencies = {
  repository?: DataRequestDashboardListRepository;
};

export function createDataRequestListGetHandler(
  dependencies: DataRequestListDependencies = {},
) {
  const repository = dependencies.repository ?? firestoreDataRequestRepository;

  return async function GET(req: NextRequest) {
    const storeId = resolveAuthenticatedStoreId(req);
    if (!storeId) {
      return NextResponse.json(
        { error: "nao autorizado" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    try {
      const encodedCursor = req.nextUrl.searchParams.get("cursor");
      const cursor = encodedCursor ? decodeDataRequestCursor(encodedCursor) : undefined;
      const page = await repository.listForDashboard(
        storeId,
        DASHBOARD_REQUEST_LIMIT,
        cursor,
      );
      const lastItem = page.items.at(-1);
      const nextCursor = page.hasMore && lastItem
        ? encodeDataRequestCursor({
            receivedAt: lastItem.receivedAt,
            requestId: lastItem.requestId,
          })
        : null;
      return NextResponse.json(
        { items: page.items, nextCursor },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof InvalidDataRequestCursorError) {
        return NextResponse.json(
          { error: "cursor invalido" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "falha ao listar solicitacoes" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  };
}

export const GET = createDataRequestListGetHandler();
