// POST /api/whatsapp/test
// Envia uma mensagem de teste (template hello_world) para um numero informado.
// Serve para o lojista validar a conexao do WhatsApp direto do dashboard.
//
// Usa as credenciais da loja (Embedded Signup) ou, se ela ainda nao conectou,
// o numero global do Nuvem Rush — o que permite testar antes do onboarding.
import { NextRequest, NextResponse } from "next/server";
import { resolveStoreId } from "@/lib/auth/session";
import { sendTestWhatsapp } from "@/lib/channels/whatsapp";

export async function POST(req: NextRequest) {
  const storeId = resolveStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim();
  if (!to || to.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "informe um numero valido com DDD (ex.: 14996807881)" },
      { status: 400 },
    );
  }

  try {
    await sendTestWhatsapp({ storeId, to });
    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error(`[whatsapp test] falha (${storeId}):`, err);
    return NextResponse.json(
      { error: "falha ao enviar", detail: String(err) },
      { status: 502 },
    );
  }
}
