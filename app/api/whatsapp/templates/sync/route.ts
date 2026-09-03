import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { storeRef } from "@/lib/firebase/admin";
import { reconcileStoreWhatsappTemplates } from "@/lib/whatsapp/templateReconciliation";
import { whatsappStatusPayload } from "@/lib/whatsapp/templateStatusView";
import type { Store } from "@/types";

export async function POST(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const result = await reconcileStoreWhatsappTemplates({ storeId, force: true }).catch((error) => {
    console.error("[whatsapp templates] explicit reconciliation failed", {
      storeId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return null;
  });
  const store = (await storeRef(storeId).get()).data() as Store | undefined;
  return NextResponse.json({
    ...whatsappStatusPayload(store?.whatsapp),
    reconciliation: result ? {
      attempted: result.attempted,
      metaAvailable: result.metaAvailable,
      createdShipmentTemplate: result.createdShipmentTemplate,
    } : { attempted: true, metaAvailable: false, createdShipmentTemplate: false },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
