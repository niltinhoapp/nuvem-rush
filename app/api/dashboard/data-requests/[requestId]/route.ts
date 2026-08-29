import { NextRequest, NextResponse } from "next/server";
import { resolveAuthenticatedStoreId } from "@/lib/auth/session";
import {
  DataRequestDeliveryError,
  deliverDataRequest,
  type DataRequestDeliveryHooks,
} from "@/lib/lgpd/dataRequestDelivery";
import {
  firestoreDataRequestRepository,
  type DataRequestDeliveryRepository,
} from "@/lib/lgpd/dataRequest.firestore";

type RouteContext = { params: Promise<{ requestId: string }> };

type DataRequestRouteDependencies = {
  repository?: DataRequestDeliveryRepository;
  hooks?: DataRequestDeliveryHooks;
  now?: () => number;
};

const REQUEST_ID_PATTERN = /^[a-f0-9]{64}$/;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export function createDataRequestGetHandler(
  dependencies: DataRequestRouteDependencies = {},
) {
  const repository = dependencies.repository ?? firestoreDataRequestRepository;
  const hooks = dependencies.hooks ?? {};
  const now = dependencies.now ?? Date.now;

  return async function GET(req: NextRequest, { params }: RouteContext) {
    const storeId = resolveAuthenticatedStoreId(req);
    if (!storeId) {
      return NextResponse.json(
        { error: "nao autorizado" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { requestId } = await params;
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return NextResponse.json(
        { error: "solicitacao nao encontrada" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    try {
      const result = await deliverDataRequest(
        repository,
        storeId,
        requestId,
        now(),
        hooks,
      );
      return NextResponse.json(
        {
          requestId,
          delivery: {
            method: "dashboard",
            delivered: true,
            deliveredAt: result.receipt.deliveredAt,
            accessCount: result.receipt.accessCount,
          },
          data: result.export,
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof DataRequestDeliveryError) {
        const status = error.code === "not_found" ? 404 : 409;
        return NextResponse.json(
          {
            error: error.code === "not_found"
              ? "solicitacao nao encontrada"
              : "solicitacao indisponivel",
          },
          { status, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "falha ao consultar solicitacao" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  };
}

export const GET = createDataRequestGetHandler();
