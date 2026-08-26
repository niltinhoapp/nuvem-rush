// OAuth callback: a Nuvemshop redireciona para ca com ?code=...
// Trocamos o code por access_token, criamos a loja e registramos webhooks.
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/nuvemshop/oauth";
import { NuvemshopClient } from "@/lib/nuvemshop/client";
import { registerRequiredWebhooks } from "@/lib/nuvemshop/webhook-registration";
import { storeRef } from "@/lib/firebase/admin";
import {
  buildStoreInstallData,
  isFirstCommercialInstall,
} from "@/lib/nuvemshop/store-install";
import { ensureTrialStarted } from "@/lib/billing/entitlement.firestore";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code ausente" }, { status: 400 });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const storeId = String(token.user_id);
    const ref = storeRef(storeId);
    const existingStore = await ref.get();
    const existing = {
      exists: existingStore.exists,
      status: existingStore.data()?.status,
    };
    const firstCommercialInstall = isFirstCommercialInstall(existing);

    // TODO: criptografar accessToken em repouso (KMS) antes de persistir.
    await ref.set(
      buildStoreInstallData(
        storeId,
        { accessToken: token.access_token, scope: token.scope },
        existing,
      ),
      // Um tombstone redacted inicia uma instalacao comercial limpa. O set
      // substitui somente o documento raiz; lgpd_suppressions permanece.
      { merge: !firstCommercialInstall },
    );

    // Trial anti-reset: concede o unico trial da loja na primeira vez (nunca
    // de novo). Roda DEPOIS do set acima (que pode substituir o doc raiz
    // inteiro num reinstall pos-redact) para a copia sincronizada no doc raiz
    // nao ser apagada em seguida. Idempotente — reinstalar nunca reinicia.
    await ensureTrialStarted(storeId);

    // Registra os webhooks obrigatorios apontando para o nosso receiver.
    const client = new NuvemshopClient(storeId, token.access_token);
    const webhookUrl = `${process.env.APP_BASE_URL}/api/webhooks/nuvemshop`;
    const registrations = await registerRequiredWebhooks(client, webhookUrl);
    const failures = registrations.filter((result) => result.status !== "success");
    const safeFailures = failures.map(({ event, status, httpStatus }) => ({
      event,
      status,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    }));
    await ref.set({
      webhookRegistration: {
        status: failures.length === 0 ? "ready" : "partial",
        checkedAt: Date.now(),
        failures: safeFailures,
      },
    }, { merge: true });

    if (failures.length > 0) {
      console.warn("[oauth] registro de webhooks incompleto", safeFailures);
      return NextResponse.json(
        { error: "instalacao incompleta: falha ao registrar webhooks obrigatorios" },
        { status: 503 },
      );
    }

    // Redireciona o lojista de volta para o admin (app incorporado).
    // Pagina de sucesso simples (nao o /dashboard embarcado, que espera o Nexo
    // do admin e trava quando a instalacao ocorre fora do iframe).
    return NextResponse.redirect(`${process.env.APP_BASE_URL}/instalado`);
  } catch (err) {
    console.error("Erro no callback OAuth:", err);
    return NextResponse.json({ error: "falha na instalacao" }, { status: 500 });
  }
}
