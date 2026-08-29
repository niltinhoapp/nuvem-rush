import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: "nao autorizado" },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      reason: "cart_signals_telemetry_only",
    },
    { status: 410 },
  );
}
