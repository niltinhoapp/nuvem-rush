import { NextRequest, NextResponse } from "next/server";
import { resolveAuthenticatedStoreId } from "@/lib/auth/session";
import {
  firestoreDataRequestRepository,
  type DataRequestDashboardListRepository,
} from "@/lib/lgpd/dataRequest.firestore";

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
      const requests = await repository.listForDashboard(
        storeId,
        DASHBOARD_REQUEST_LIMIT,
      );
      return NextResponse.json({ requests }, { headers: NO_STORE_HEADERS });
    } catch {
      return NextResponse.json(
        { error: "falha ao listar solicitacoes" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  };
}

export const GET = createDataRequestListGetHandler();
