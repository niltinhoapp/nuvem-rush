// GET   /api/flows/:id -> retorna um fluxo
// PATCH /api/flows/:id -> altera status (active/paused/draft)
// DELETE /api/flows/:id -> soft delete (deletedAt)
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { getFlow, updateFlowStatus, softDeleteFlow, FLOW_STATUSES } from "@/lib/flows/repo";
import { getStoreCommercialCache } from "@/lib/billing/accessSignal.firestore";
import { isCommercialAccessGranted, resolveStoreCommercialState } from "@/lib/billing/policy";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const { id } = await ctx.params;
  const flow = await getFlow(storeId, id);
  if (!flow) return NextResponse.json({ error: "fluxo nao encontrado" }, { status: 404 });
  return NextResponse.json({ flow });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const status = body?.status;
  if (typeof status !== "string" || !(FLOW_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "status invalido" }, { status: 400 });
  }

  // Mesmo gate comercial usado por POST /api/flows: reativar um fluxo
  // (voltar a gerar jobs/custo) exige acesso comercial liberado agora.
  if (status === "active") {
    const commercialCache = await getStoreCommercialCache(storeId);
    const commercial = commercialCache ? resolveStoreCommercialState(commercialCache, Date.now()) : "billing_unknown";
    if (!isCommercialAccessGranted(commercial)) {
      return NextResponse.json(
        { error: "periodo gratis encerrado ou assinatura inativa", commercial },
        { status: 402 },
      );
    }
  }

  try {
    const flow = await updateFlowStatus(storeId, id, status as "active" | "paused" | "draft");
    return NextResponse.json({ flow });
  } catch (err) {
    if (err instanceof Error && err.message === "fluxo_nao_encontrado") {
      return NextResponse.json({ error: "fluxo nao encontrado" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "store_inactive") {
      return NextResponse.json({ error: "loja inativa" }, { status: 403 });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    await softDeleteFlow(storeId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "fluxo_nao_encontrado") {
      return NextResponse.json({ error: "fluxo nao encontrado" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "store_inactive") {
      return NextResponse.json({ error: "loja inativa" }, { status: 403 });
    }
    throw err;
  }
}
