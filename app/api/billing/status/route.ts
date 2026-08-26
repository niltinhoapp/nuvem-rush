// GET /api/billing/status -> estado comercial da store logada (Billing V1).
// So leitura; nunca inicia um trial (isso so acontece no callback OAuth).
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthenticatedStoreId } from "@/lib/auth/session";
import { getStoreCommercialInput } from "@/lib/billing/entitlement.firestore";
import { resolveCommercialState, trialDaysRemaining } from "@/lib/billing/policy";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET(req: NextRequest) {
  const storeId = resolveAuthenticatedStoreId(req);
  if (!storeId) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const input = await getStoreCommercialInput(storeId);
  if (!input) {
    return NextResponse.json({ error: "loja nao encontrada" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const now = Date.now();
  const state = resolveCommercialState(input, now);
  return NextResponse.json(
    {
      state,
      trialEndsAt: input.trialEndsAt ?? null,
      trialDaysRemaining: trialDaysRemaining(input.trialEndsAt, now),
    },
    { headers: NO_STORE_HEADERS },
  );
}
