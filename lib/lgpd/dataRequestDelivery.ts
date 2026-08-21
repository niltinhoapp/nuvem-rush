import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import type {
  DataRequestDeliveryRepository,
  DataRequestDeliveryReceipt,
} from "./dataRequest.firestore";
import type { DataRequestExport } from "./dataRequest";

export type DataRequestDeliveryErrorCode =
  | "not_found"
  | "store_unavailable"
  | "not_deliverable";

export class DataRequestDeliveryError extends Error {
  constructor(readonly code: DataRequestDeliveryErrorCode) {
    super(`lgpd_data_request_delivery_${code}`);
    this.name = "DataRequestDeliveryError";
  }
}

export type DataRequestDeliveryHooks = {
  afterCompile?: (compiled: DataRequestExport) => Promise<void>;
};

export type DataRequestDeliveryResult = {
  export: DataRequestExport;
  receipt: DataRequestDeliveryReceipt;
};

export async function deliverDataRequest(
  repository: DataRequestDeliveryRepository,
  storeId: string,
  requestId: string,
  now: number = Date.now(),
  hooks: DataRequestDeliveryHooks = {},
): Promise<DataRequestDeliveryResult> {
  const snapshot = await repository.loadForDelivery(storeId, requestId);
  if (!snapshot) throw new DataRequestDeliveryError("not_found");
  if (!isStoreCommerciallyActive(snapshot.storeStatus)) {
    throw new DataRequestDeliveryError("store_unavailable");
  }

  let compiled: DataRequestExport;
  try {
    compiled = await repository.compileForDelivery(storeId, snapshot.evidence, now);
  } catch {
    throw new DataRequestDeliveryError("not_deliverable");
  }
  await hooks.afterCompile?.(compiled);

  // Guarda final: a transacao revalida store + request imediatamente antes
  // de a rota poder responder com PII e registra a evidencia idempotente.
  let receipt: DataRequestDeliveryReceipt;
  try {
    receipt = await repository.markDelivered(storeId, requestId, now);
  } catch (error) {
    if (error instanceof Error && error.message === "lgpd_data_request_store_unavailable") {
      throw new DataRequestDeliveryError("store_unavailable");
    }
    throw new DataRequestDeliveryError("not_deliverable");
  }
  return { export: compiled, receipt };
}
