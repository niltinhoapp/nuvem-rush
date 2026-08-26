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
import { recordBillingAccessSignal } from "@/lib/billing/accessSignal.firestore";

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

    // Sinal comercial (Billing V1 — ver lib/billing/policy.ts): a chamada
    // real acima ja PROVA se a Nuvemshop concede acesso a API para esta
    // loja agora. Sucesso total = acesso liberado. Um 402 entre as falhas =
    // bloqueado (documentado: 402 cobre tanto falta de pagamento quanto
    // esgotamento dos dias gratis). Outras falhas (timeout/5xx) sao
    // ambiguas — nao gravamos nada, o proximo sinal real decide (fail-closed
    // por staleness, nunca por um chute aqui).
    const has402 = failures.some((f) => f.httpStatus === 402);
    if (failures.length === 0) {
      await recordBillingAccessSignal(storeId, false);
    } else if (has402) {
      await recordBillingAccessSignal(storeId, true);
    }

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
