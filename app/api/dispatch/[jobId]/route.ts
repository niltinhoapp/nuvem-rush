// Disparo manual/externo de um job (ex.: reprocessamento ou futura migracao
// para Cloud Tasks). Protegido por segredo interno. O fluxo normal usa o cron.
import { NextRequest, NextResponse } from "next/server";
import { dispatchJob } from "@/lib/dispatch";

export async function POST(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  if (req.headers.get("x-dispatch-secret") !== process.env.INTERNAL_DISPATCH_SECRET) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId ausente" }, { status: 400 });

  const { jobId } = await ctx.params;
  const result = await dispatchJob(storeId, jobId);
  return NextResponse.json(result);
}
