// Planos do Nuvem Rush com cota SEPARADA de e-mail e WhatsApp.
//
// IMPORTANTE (modelo Tech Provider): quem paga a Meta pelas mensagens de
// WhatsApp e o LOJISTA (Embedded Signup usa a conta dele). O custo variavel
// NAO e nosso. Logo, as cotas de WhatsApp NAO existem para cobrir custo — elas
// so contem abuso e protegem a reputacao. Por isso sao generosas (vantagem
// competitiva vs. concorrentes que limitam pouco porque bancam o custo).
// O e-mail (Resend) custa fracao de centavo e e nosso, mas tambem e barato.
import type { Plan } from "@/types";

export interface PlanDef {
  label: string;
  priceBRL: number;
  contactsLimit: number;
  emailsMonthLimit: number; // persiste em quotas.dispatchesMonthLimit
  whatsappMonthLimit: number; // persiste em quotas.whatsappMonthLimit
}

export const PLANS: Record<Plan, PlanDef> = {
  essencial: {
    label: "Essencial",
    priceBRL: 39.9,
    contactsLimit: 1000,
    emailsMonthLimit: 1000,
    whatsappMonthLimit: 1000,
  },
  crescimento: {
    label: "Crescimento",
    priceBRL: 89.9,
    contactsLimit: 5000,
    emailsMonthLimit: 5000,
    whatsappMonthLimit: 5000,
  },
  turbo: {
    label: "Turbo",
    priceBRL: 149.9,
    contactsLimit: 20000,
    emailsMonthLimit: 20000,
    whatsappMonthLimit: 20000,
  },
};
