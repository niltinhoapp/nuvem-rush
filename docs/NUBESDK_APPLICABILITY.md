# Aplicabilidade do NubeSDK — Nuvem Rush

**Base auditada:** `main` em `b03908379b802a2f20e57a4ef2a3a44e3c7c5bdc`  
**Data:** 12/08/2026  
**Classificação:** `REQUIRES_OFFICIAL_CONFIRMATION`

## Regra oficial

A checklist geral de homologação determina que, desde 5 de junho de 2026, novas submissões não são aprovadas sem NubeSDK. Também exige execução em Web Worker, ausência de `window`, `document`, jQuery e DOM direto, e UI por componentes/slots do NubeSDK.

Fontes oficiais:

- https://dev.nuvemshop.com.br/docs/homologation/checklist
- https://dev.nuvemshop.com.br/docs/homologation/requirements
- https://dev.nuvemshop.com.br/docs/applications/overview

A documentação do NubeSDK, porém, define o produto como toolkit para aplicações executadas diretamente no **storefront e checkout**, em Web Worker e UI Slots:

- https://dev.nuvemshop.com.br/docs/applications/nube-sdk/overview
- https://dev.nuvemshop.com.br/docs/applications/nube-sdk/migration-guide

A documentação específica de aplicativos incorporados ao Admin exige **iframe, Nexo, Nimbus e React**, sem mencionar substituição por NubeSDK:

- https://dev.nuvemshop.com.br/docs/applications/native
- https://dev.nuvemshop.com.br/docs/developer-tools/templates

## Arquitetura do Nuvem Rush

O Nuvem Rush é um app incorporado ao Admin:

- Next.js 16 + React 19;
- `@tiendanube/nexo` para handshake e session token;
- Nimbus Components, Icons e Styles;
- carregamento em iframe com `frame-ancestors` Nuvemshop/Tiendanube;
- não injeta UI em storefront ou checkout;
- `window`/`document` aparecem em páginas React/iframe e no fluxo standalone da Meta, não em script legado de storefront.

## Comparação

| Questão | Evidência |
|---|---|
| Isenção explícita para embedded apps | Não encontrada |
| Escopo técnico documentado do NubeSDK | Storefront e checkout |
| Exigência geral de homologação | Redação universal |
| Regra específica de embedded apps | iframe + Nexo + Nimbus + React |
| Conciliação oficial entre as regras | Não encontrada |

## Conclusão

Não há base segura para instalar NubeSDK no frontend incorporado: seu modelo Web Worker/UI Slots não substitui o iframe/Nexo descrito para o Admin. Ao mesmo tempo, a regra geral não concede isenção explícita. A documentação é materialmente contraditória quanto ao alcance.

**Decisão:** `REQUIRES_OFFICIAL_CONFIRMATION`.

Não adicionar NubeSDK antes de resposta escrita da Nuvemshop.

## Risco

**P0 / alto:** uma submissão posterior a 5/6/2026 pode ser recusada por interpretação literal da checklist. Uma migração especulativa também pode quebrar a arquitetura oficial de app incorporado e o fluxo Meta que depende de browser/DOM em página standalone.

## Pergunta pronta para o suporte

> O Nuvem Rush (App ID 34663) é exclusivamente um aplicativo incorporado ao Admin, carregado em iframe e implementado com React, Nimbus e Nexo. Ele não injeta scripts nem componentes no storefront ou checkout. A checklist geral de homologação exige NubeSDK desde 5/6/2026, enquanto a documentação do NubeSDK o define para storefront/checkout em Web Worker e a documentação de apps incorporados continua exigindo iframe/Nexo/Nimbus/React. Nesse cenário, o NubeSDK é obrigatório para o app incorporado? Se sim, qual parte deve usar NubeSDK e como ele deve coexistir com Nexo/iframe? Solicitamos confirmação escrita e, se aplicável, a referência técnica específica.
