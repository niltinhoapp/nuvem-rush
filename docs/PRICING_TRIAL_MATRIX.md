# Matriz de pricing, trial e limites

Base revalidada: `main` @ `b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc`, em 12/08/2026.

**Decisão:** `OWNER_DECISION_REQUIRED`. Nenhum valor foi alterado.

| Arquivo/rota | Valor exibido | Contexto | Fonte |
|---|---|---|---|
| `lib/plans.ts` | Essencial R$ 39,90/mês | Definição interna do plano | Código |
| `lib/plans.ts` | Crescimento R$ 89,90/mês | Definição interna do plano | Código |
| `lib/plans.ts` | Turbo R$ 149,90/mês | Definição interna do plano | Código |
| `lib/plans.ts` | 1.000 / 5.000 / 20.000 contatos | Limite por plano | Código |
| `lib/plans.ts` | 1.000 / 5.000 / 20.000 e-mails/mês | Limite por plano | Código |
| `lib/plans.ts` | 1.000 / 5.000 / 20.000 WhatsApps/mês | Limite por plano | Código |
| `app/api/auth/nuvemshop/callback/route.ts` | 14 dias grátis; plano Essencial | Comentário da instalação; o código não grava data de expiração do trial | Código/comentário |
| `docs/faq-ficha-app.md` | 14 dias grátis | Texto planejado para ficha | Documento |
| `docs/faq-ficha-app.md` | Cota mensal; envios pausam e ficam pendentes | Alegação comercial/operacional | Documento |
| `docs/embedded-signup.md` | ~R$ 0,33 por mensagem | Estimativa interna de custo Meta, não preço do app | Documento técnico |
| `lib/dispatch.ts` e `types/index.ts` | Cotas por canal | Enforcement interno; contém estimativa ~R$0,33 em comentário | Código |
| `app/page.tsx` | Nenhum preço/trial | Landing pública mínima | Código |
| `README.md` | Hobby/Pro Vercel, sem preço do app | Infra, não oferta comercial | Documento |
| Portal/LP externa/vídeo | Não auditado | Fora do repositório/conexão não autorizada | Pendente |

Não foram encontradas ofertas beta, vitalícias, trial de 7 ou 30 dias no conteúdo textual rastreado da `main`.

## Decisões do proprietário

1. Confirmar os três preços e periodicidade.
2. Confirmar trial de 14 dias.
3. Confirmar se todos os recursos ficam liberados no trial.
4. Confirmar comportamento ao atingir cota: “pausam e ficam pendentes” precisa coincidir com o backend.
5. Confirmar quem arca com custos Meta e como isso será comunicado.
6. Uniformizar Portal, ficha, landing, termos, vídeo e produto somente após a decisão.
