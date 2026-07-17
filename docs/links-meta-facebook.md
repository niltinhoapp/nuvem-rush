# Links da Meta/Facebook — Guia de Referência (Conect Web Ads)

> IDs do seu negócio (já embutidos nos links):
> - **Portfólio empresarial (Business Manager):** 663024740233911
> - **WABA (conta do WhatsApp "Conect Web"):** 722759973505603
> - **Conta de anúncios "conect":** 714436504563749
> - **App de desenvolvedor "Nuvem Rush":** 908269564938670

---

## Gestão do negócio

**Gerenciador de Negócios (Business Manager)**
https://business.facebook.com/settings/?business_id=663024740233911
Central de configurações da empresa: pessoas, ativos (páginas, contas de anúncios, WhatsApp), permissões, usuários do sistema, segurança. É onde você atribui quem pode mexer em quê.

**Meta Business Suite (painel geral)**
https://business.facebook.com/latest/home?business_id=663024740233911
Painel do dia a dia: posts, caixa de entrada unificada (FB/IG/WhatsApp), insights e atalhos pra todas as ferramentas.

**Informações da empresa / Verificação**
https://business.facebook.com/settings/info?business_id=663024740233911
Dados da empresa (CNPJ, endereço) e o status da verificação ("Verificada" desde 15/07/2026).

**Qualidade da conta (Account Quality)**
https://business.facebook.com/accountquality/?business_id=663024740233911
Mostra restrições, avisos e problemas de política em qualquer ativo (contas de anúncios, WABA, páginas). Primeiro lugar pra olhar quando algo for bloqueado.

---

## WhatsApp Business

**Gerenciador do WhatsApp (visão geral)**
https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=663024740233911&asset_id=722759973505603
Central da conta do WhatsApp: alertas, limites de mensagens, insights, status da conta.

**Modelos de mensagem (templates)**
https://business.facebook.com/latest/whatsapp_manager/message_templates/?business_id=663024740233911&asset_id=722759973505603
Criar, editar e acompanhar aprovação dos templates (é aqui que vamos criar o `pos_venda_agradecimento` quando o bloqueio cair).

**Números de telefone**
https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=663024740233911&asset_id=722759973505603
Status e qualidade do número +55 14 99680-7881, limites de envio e configurações do perfil comercial.

**Cobrança do WhatsApp (conta Conect Web)**
https://business.facebook.com/latest/billing_hub/accounts/details/?payment_account_id=1696477110974488&asset_id=722759973505603&business_id=663024740233911&placement=whatsapp_ads
Saldo, forma de pagamento (MasterCard ····2745), histórico de transações e recibos das conversas cobradas pela Meta.

---

## Anúncios

**Gerenciador de Anúncios (Ads Manager)**
https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=714436504563749&business_id=663024740233911
Criar e gerenciar campanhas, conjuntos e anúncios. É aqui que vamos montar a campanha de Reconhecimento de Marca (até R$20/dia).

**Cobrança e pagamentos (geral)**
https://business.facebook.com/latest/billing_hub/accounts/?business_id=663024740233911
Todas as contas de cobrança do portfólio (anúncios + WhatsApp), formas de pagamento e atividade. Pendente: adicionar pagamento na conta de anúncios "conect".

**Públicos (Audiences)**
https://business.facebook.com/adsmanager/audiences?act=714436504563749&business_id=663024740233911
Criar públicos salvos, personalizados e semelhantes (lookalike) pra usar nas campanhas.

**Gerenciador de Eventos (Pixel/Conversões)**
https://business.facebook.com/events_manager2/?act=714436504563749&business_id=663024740233911
Configurar o Pixel do Facebook e a API de Conversões pra rastrear visitas e vendas do site.

---

## Desenvolvedor

**Painel de apps (Meta for Developers)**
https://developers.facebook.com/apps/
Lista dos seus apps de desenvolvedor (Nuvem Rush e Conhecimento).

**App Nuvem Rush (painel)**
https://developers.facebook.com/apps/908269564938670/dashboard/?business_id=663024740233911
Painel do app que conecta o Nuvem Rush à API do WhatsApp: casos de uso, permissões, webhook.

**Configuração do WhatsApp no app (webhooks)**
https://developers.facebook.com/apps/908269564938670/use_cases/customize/wa-configurations-v2/?product_route=whatsapp-business&business_id=663024740233911&use_case_enum=WHATSAPP_BUSINESS_MESSAGING&selected_tab=wa-configurations-v2
Onde configuramos a URL de callback (https://nuvem-rush.vercel.app/api/webhooks/whatsapp) e o verify token.

**Usuários do sistema (System Users / tokens)**
https://business.facebook.com/settings/system-users?business_id=663024740233911
Gerar e gerenciar os tokens permanentes da API (o WHATSAPP_ACCESS_TOKEN veio daqui).

---

## Suporte

**Suporte Direto (tíquetes)**
https://business.facebook.com/direct-support/?business_id=663024740233911
Abrir e acompanhar casos de suporte. Casos abertos: 38213333671598641 (fechado) e 36962071840104512 (escalação).

**Central de Suporte para Empresas (assistente)**
https://business.facebook.com/business-support-home/?business_id=663024740233911
Assistente de IA da Meta + visão de problemas da conta + histórico de casos.

**Fórum de Desenvolvedores**
https://developers.facebook.com/community/
Onde engenheiros da Meta respondem problemas técnicos. Nosso post: https://developers.facebook.com/community/threads/795438236929349/

**Status da plataforma Meta**
https://metastatus.com/
Verifica se as APIs da Meta (WhatsApp incluso) estão fora do ar — bom checar antes de debugar erro estranho.

---

## Desenvolvedor — Suporte e ferramentas extras

**Ações necessárias (apps)**
https://developers.facebook.com/required-actions/
Pendências que a Meta exige nos seus apps de desenvolvedor (análises, políticas, atualizações obrigatórias). Vale checar de vez em quando.

**Suporte ao desenvolvedor (central)**
https://developers.facebook.com/support/
Porta de entrada do suporte técnico para APIs: FAQs, bugs e canais de contato.

**Ferramenta de Bugs**
https://developers.facebook.com/support/bugs/
Relatar bugs de API diretamente à engenharia da Meta e pesquisar bugs já reportados por outros devs (dá pra "subscribe" num bug existente). Alternativa forte ao fórum quando o problema é claramente um defeito da plataforma.

**Perguntas frequentes (FAQ dev)**
https://developers.facebook.com/support/faq/
FAQ técnica gigante, incluindo seção da API do WhatsApp Business (limites de templates, erros comuns, motivos de rejeição de modelos etc.).

**Relatar um incidente**
https://developers.facebook.com/incident/report/
Reportar indisponibilidade/instabilidade da plataforma que esteja afetando seu app.

**Blog Meta for Developers**
https://developers.facebook.com/blog/
Novidades e mudanças das APIs (bom pra ficar sabendo de breaking changes do WhatsApp).

**Termos da plataforma / Políticas do Desenvolvedor**
https://developers.facebook.com/terms/dfc_platform_terms/ · https://developers.facebook.com/devpolicy/
As regras do jogo para apps que usam APIs da Meta — úteis na hora de homologações e revisões de app.

---

## Segurança

**Autenticação de dois fatores (2FA)**
https://www.facebook.com/security/2fac/settings
Configuração da 2FA do seu perfil pessoal (já ativada).

**Apps do GitHub/terceiros autorizados**
https://www.facebook.com/settings?tab=business_tools
Ver e revogar apps e integrações com acesso à sua conta.
