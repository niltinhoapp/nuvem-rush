// Canal de e-mail via Resend. Renderiza template ou conteudo gerado por IA.
import { Resend } from "resend";
import { col } from "@/lib/firebase/admin";
import { generateEmailContent } from "@/lib/ai/openai";
import type { Step } from "@/types";

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

  let subject = "Novidade pra voce";
  let html = "";

  if (step.aiPrompt) {
    const ai = await generateEmailContent(step.aiPrompt, { contact });
    subject = ai.subject;
    html = ai.html;
  } else if (step.templateId) {
    const tpl = (await col(storeId, "templates").doc(step.templateId).get()).data();
    subject = (tpl?.subject as string) ?? subject;
    html = (tpl?.html as string) ?? "";
  }

  await resendClient().emails.send({
    from: "Loja <no-reply@seu-dominio.com>",
    to: contact.email,
    subject,
    html,
  });
}
