// POST /api/whatsapp/test
// Envia uma mensagem de teste (template hello_world) para um numero informado.
// Serve para o lojista validar a conexao do WhatsApp direto do dashboard.
//
// Usa as credenciais da loja (Embedded Signup) ou, se ela ainda nao conectou,
// o numero global do Nuvem Rush — o que permite testar antes do onboarding.
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthenticatedStoreId } from "@/lib/auth/session";
import { sendTestWhatsapp } from "@/lib/channels/whatsapp";
import { claimWhatsappTestAttempt } from "@/lib/whatsapp/testRateLimit.firestore";

function safeProviderFailure(error: unknown): "provider_unavailable" | "provider_rejected" {
  const message = error instanceof Error ? error.message : "";
  return /nao configurad/i.test(message) ? "provider_unavailable" : "provider_rejected";
}

export async function POST(req: NextRequest) {
  const storeId = resolveAuthenticatedStoreId(req);
  if (!storeId) return NextResponse.json({ error: "loja nao identificada" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim();
  if (!to || to.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "informe um numero valido com DDD (ex.: 14996807881)" },
      { status: 400 },
    );
  }

  const attempt = await claimWhatsappTestAttempt(storeId);
  if (!attempt.ok) {
    const error = attempt.reason === "store_inactive"
      ? "loja inativa"
      : attempt.reason === "cooldown"
        ? "aguarde antes de enviar outro teste"
        : "limite diario de testes atingido";
    return NextResponse.json({ error }, { status: attempt.status });
  }

  try {
    await sendTestWhatsapp({ storeId, to });
    return NextResponse.json({ sent: true });
  } catch (err) {
    // Sem destino, mensagem, token, resposta do provider ou erro bruto.
    console.error("[whatsapp test] provider failure", {
      category: safeProviderFailure(err),
      name: err instanceof Error ? err.name : "unknown",
    });
    return NextResponse.json(
      { error: "falha ao enviar" },
      { status: 502 },
    );
  }
}
