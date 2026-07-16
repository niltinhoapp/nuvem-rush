// Planos do Nuvem Rush com cota SEPARADA de e-mail e WhatsApp.
//
// Racional dos precos (jul/2026): a Meta cobra ~R$0,31/mensagem de marketing
// no Brasil (~R$0,33 com IOF), enquanto e-mail custa fracao de centavo.
// Cada plano cobre o pior caso (cota inteira de WhatsApp consumida) com
// margem de ~40-55%. Nunca oferecer WhatsApp "ilimitado".
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
    emailsMonthLimit: 300,
    whatsappMonthLimit: 50,
  },
  crescimento: {
    label: "Crescimento",
    priceBRL: 89.9,
    contactsLimit: 5000,
    emailsMonthLimit: 1500,
    whatsappMonthLimit: 150,
  },
  turbo: {
    label: "Turbo",
    priceBRL: 149.9,
    contactsLimit: 20000,
    emailsMonthLimit: 5000,
    whatsappMonthLimit: 250,
  },
};
