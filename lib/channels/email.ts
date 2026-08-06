// Canal de e-mail via Resend. Renderiza template ou conteudo gerado por IA.
import { Resend } from "resend";
import { col } from "@/lib/firebase/admin";
import { generateEmailContent } from "@/lib/ai/openai";
import type { Cart, Order, Step } from "@/types";

// Substitui placeholders {{...}} no assunto/html do e-mail.
function fillPlaceholders(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => data[k] ?? "");
}

// Inicializacao preguiçosa: nao instanciar no load do modulo (quebra se a key
// nao estiver setada e derruba qualquer rota que importe este arquivo).
let _resend: Resend | null = null;
function resendClient(): Resend {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY nao configurada");
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendEmail(params: {
  storeId: string;
  enrollmentId: string;
  step: Step;
}): Promise<void> {
  const { storeId, enrollmentId, step } = params;

  const enroll = (await col(storeId, "enrollments").doc(enrollmentId).get()).data()!;
  const contact = (await col(storeId, "contacts").doc(enroll.contactId).get()).data()!;
  if (!contact.email) throw new Error("contato sem email");

  // Carrega pedido/carrinho da origem para resolver placeholders.
  const order = enroll.orderId
    ? ((await col(storeId, "orders").doc(enroll.orderId).get()).data() as Order | undefined)
    : undefined;
  const cart = enroll.cartId
    ? ((await col(storeId, "carts").doc(enroll.cartId).get()).data() as Cart | undefined)
    : undefined;
  const vars: Record<string, string> = {
    name: contact.name ?? "",
    recoveryUrl: cart?.recoveryUrl ?? "",
    cartUrl: cart?.recoveryUrl ?? "",
    trackingUrl: order?.trackingUrl ?? "",
    trackingCode: order?.trackingCode ?? "",
    orderNumber: order?.nsOrderId ?? "",
  };

  let subject = "Novidade pra voce";
  let html = "";

  if (step.aiPrompt) {
    try {
      const ai = await generateEmailContent(step.aiPrompt, { contact });
      subject = ai.subject;
      html = ai.html;
    } catch (err) {
      // IA indisponivel (sem OPENAI_API_KEY, timeout ou erro): NUNCA derruba o
      // envio. Cai para o template configurado, se houver.
      console.warn("[email] IA indisponivel, usando fallback:", String(err));
      if (step.templateId) {
        const tpl = (await col(storeId, "templates").doc(step.templateId).get()).data();
        subject = (tpl?.subject as string) ?? subject;
        html = (tpl?.html as string) ?? "";
      }
    }
  } else if (step.templateId) {
    const tpl = (await col(storeId, "templates").doc(step.templateId).get()).data();
    subject = (tpl?.subject as string) ?? subject;
    html = (tpl?.html as string) ?? "";
  }

  // Sem corpo apos os fallbacks: pula o envio (evita e-mail vazio) sem erro.
  if (!html.trim()) {
    console.warn("[email] sem conteudo (IA falhou e sem template); envio pulado.");
    return;
  }

  subject = fillPlaceholders(subject, vars);
  html = fillPlaceholders(html, vars);

  await resendClient().emails.send({
    from: "Loja <no-reply@seu-dominio.com>",
    to: contact.email,
    subject,
    html,
  });
}
