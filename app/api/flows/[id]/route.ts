// GET /api/flows/:id -> retorna um fluxo
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { getFlow } from "@/lib/flows/repo";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const { id } = await ctx.params;
  const flow = await getFlow(storeId, id);
  if (!flow) return NextResponse.json({ error: "fluxo nao encontrado" }, { status: 404 });
  return NextResponse.json({ flow });
}
