# Nuvem Rush — Rush IA: criação assistida de fluxos

**Data da decisão:** 13/08/2026  
**Status:** APROVADO COMO DIREÇÃO DE PRODUTO — IMPLEMENTAÇÃO ADIADA  
**Momento de execução:** somente após estabilização técnica do Nuvem Rush, conclusão da homologação/publicação na Nuvemshop e validação do fluxo principal em produção.  
**Objetivo:** permitir que lojistas pequenos e intermediários criem automações em linguagem natural, sem precisar dominar gatilhos, condições, delays, WhatsApp, e-mail, APIs ou webhooks.

---

## 1. Decisão de produto

A funcionalidade é tecnicamente viável e permanece aprovada para uma etapa posterior do Nuvem Rush.

No entanto, **Rush IA não faz parte do trabalho de pré-homologação atual**. Nenhuma implementação de IA deve ser iniciada enquanto os bloqueadores técnicos, NubeSDK, testes de homologação e publicação do app não estiverem estabilizados.

Quando iniciada, a Rush IA funcionará como uma **criadora assistida de fluxos**, e não como um agente com liberdade total sobre a loja.

Princípio do produto:

> **O lojista diz o que quer automatizar. O Nuvem Rush monta uma proposta usando somente capacidades reais do sistema. O lojista revisa, edita se quiser e confirma antes de ativar.**

A criação manual continuará disponível.

---

## 2. Pré-condições para iniciar a Rush IA

A implementação só deve começar quando todos estes pontos estiverem atendidos:

- homologação/publicação do Nuvem Rush estabilizada;
- NubeSDK e integrações exigidas pela Nuvemshop validados;
- motor de automações estável;
- contratos reais de `Flow`, `Trigger`, `Condition` e `Step` consolidados;
- execução, idempotência, retry e scheduler estabilizados;
- WhatsApp e e-mail funcionando nos fluxos suportados;
- lista real de capacidades do motor documentada;
- testes principais do produto verdes.

Até lá, este documento funciona como **decisão arquitetural e backlog futuro**, não como autorização para alterar o produto atual.

---

## 3. Experiência esperada

Na criação de automação haverá duas opções:

### Configurar manualmente

O lojista usa o construtor visual normalmente.

### Criar com Rush IA

O lojista descreve o objetivo em português comum, por exemplo:

> Quero tentar recuperar clientes que compraram café e não voltaram a comprar depois de 30 dias.

A Rush IA interpreta a intenção e monta **somente aquilo que o motor vigente conseguir representar e executar**.

Antes de qualquer ativação, o fluxo será apresentado no construtor com uma mensagem semelhante a:

> **Criei esta automação para você. Revise antes de ativar.**

A Rush IA não poderá ativar um fluxo novo automaticamente no MVP. A confirmação do lojista será obrigatória.

---

## 4. Arquitetura correta

A saída do modelo de IA **não será o contrato de produção do motor**.

Arquitetura prevista:

`pedido em linguagem natural`

`→ modelo de IA`

`→ AI Draft / intenção estruturada`

`→ Capability Registry`

`→ compiler/adapter do Nuvem Rush`

`→ schema oficial Flow/Trigger/Condition/Step`

`→ validação backend`

`→ preview no Flow Builder`

`→ revisão/edição do lojista`

`→ confirmação explícita`

`→ persistência/ativação`

### Regra importante

O JSON conceitual usado em versões anteriores deste documento **não deve ser tratado como contrato de backend**.

O contrato final deverá ser derivado dos tipos oficiais existentes no projeto no momento da implementação.

No modelo já auditado do Nuvem Rush, `delay` não deve ser presumido como uma ação independente. O modelo oficial vigente utiliza o atraso associado ao `Step`, separado da ação. Da mesma forma, nomes conceituais como `CHECK_REPURCHASE`, `WHATSAPP_TEMPLATE` ou outros não podem ser introduzidos como novos `ActionType` apenas porque a IA os gerou.

A implementação futura deverá adaptar a intenção da IA ao contrato oficial vigente, sem alterar silenciosamente o motor para acomodar respostas do modelo.

---

## 5. Capability Registry — obrigatório

Antes da Rush IA ser liberada, deverá existir uma fonte de verdade das capacidades que ela pode utilizar.

Exemplos de categorias do registro:

- gatilhos disponíveis;
- condições disponíveis;
- campos filtráveis;
- unidades de delay disponíveis;
- ações disponíveis;
- canais disponíveis;
- templates disponíveis;
- capacidades dependentes da Nuvemshop;
- capacidades dependentes do WhatsApp;
- funcionalidades experimentais ou indisponíveis.

A IA recebe esse conjunto como limite operacional.

### Regra de não invenção

Se o lojista solicitar algo não suportado, a Rush IA deverá:

1. identificar que a capacidade não existe;
2. não fabricar um gatilho, condição ou ação;
3. explicar de forma simples a limitação;
4. quando possível, oferecer uma alternativa realmente suportada.

Exemplo:

> Essa condição ainda não está disponível no Nuvem Rush. Posso montar uma alternativa usando os recursos atuais.

---

## 6. Escopo inicial da Rush IA

O escopo real será determinado pelo Capability Registry existente no momento da implementação.

Podem ser considerados, **somente quando suportados e validados pelo motor**, recursos como:

- pedido criado;
- pedido pago;
- pedido enviado;
- carrinho abandonado;
- filtros por produto, SKU, categoria, marca ou valor;
- segmentação de cliente;
- espera em minutos, horas ou dias;
- WhatsApp com template permitido;
- e-mail;
- tags;
- webhooks;
- tarefas ou outras ações já existentes no contrato oficial;
- recompra, cupom, pedido entregue e outras jornadas somente se houver suporte técnico real e dados confiáveis.

**Este documento não cria novas capacidades do backend.**

---

## 7. Segurança e previsibilidade

Requisitos obrigatórios:

1. A IA nunca ativa um fluxo novo sem confirmação explícita do lojista no MVP.
2. A IA utiliza somente capacidades presentes no Capability Registry.
3. A saída do modelo nunca é persistida como fluxo executável sem compilação e validação backend.
4. O payload final deve obedecer ao schema oficial vigente do Nuvem Rush.
5. Valores inválidos, ambíguos ou incompatíveis devem ser rejeitados ou devolvidos para esclarecimento.
6. A IA não pode contornar opt-out, consentimento, regras internas ou políticas aplicáveis aos canais.
7. Templates de WhatsApp continuam sujeitos às regras e aprovações aplicáveis da WhatsApp Business Platform.
8. Criações e alterações assistidas devem possuir logs/auditoria.
9. O preview deve mostrar ao lojista o comportamento do fluxo antes da ativação.
10. Dados pessoais de consumidores não devem ser enviados ao modelo quando não forem necessários.
11. Segredos, tokens e credenciais nunca entram no contexto do modelo.
12. Falha da IA não pode impedir o uso do construtor manual.

---

## 8. Primeira versão recomendada

Quando as pré-condições forem atendidas, a primeira entrega deverá ser pequena:

- botão **Criar com IA**;
- campo de linguagem natural;
- AI Draft estruturado;
- Capability Registry;
- compiler/adapter para o modelo oficial do Nuvem Rush;
- validação backend;
- preview no Flow Builder;
- edição manual;
- confirmação antes de ativar;
- telemetria de uso e custo;
- fallback para criação manual.

Não incluir nessa primeira entrega um agente autônomo administrando a loja.

---

## 9. Evolução posterior

Depois da criação assistida estar estável, poderá ser avaliado o modo **Pergunte à Rush IA**, com sugestões de jornadas baseadas apenas em dados autorizados e capacidades reais.

Possíveis evoluções:

- sugestões de automações;
- análise de desempenho dos fluxos;
- sugestões de otimização;
- identificação de oportunidades de recompra;
- criação de variações de jornada;
- recomendações orientadas a resultado.

Essas funções são posteriores e não devem aumentar o escopo da primeira versão.

---

## 10. Posicionamento do produto

Evitar apresentar a função apenas como "ChatGPT dentro do Nuvem Rush".

Nome de trabalho:

**Rush IA**

Mensagem principal possível:

> **Você diz o que quer automatizar. O Nuvem Rush monta o fluxo para você.**

Direção estratégica:

> **Motor avançado por baixo, experiência simples por cima.**

O diferencial esperado é reduzir a barreira técnica para o lojista, e não apenas adicionar um chatbot ao painel.

---

## 11. Estratégia comercial — hipótese, não preço definitivo

A hipótese registrada para avaliação futura é incluir a Rush IA na assinatura, evitando uma cobrança separada visível apenas pelo uso da IA.

Referência de estudo registrada:

- primeiros 100 lojistas: R$ 59,90/mês;
- referência posterior: R$ 89,90/mês para novos clientes;
- possibilidade de preço fundador, se a margem permitir.

**Esses valores são hipótese comercial e não devem alterar automaticamente pricing, Portal, checkout, landing page ou planos atuais.** Antes de qualquer mudança comercial, custos reais e estratégia de lançamento devem ser novamente validados.

---

## 12. Controle de custo da IA

A criação assistida tende a consumir muito menos IA do que atendimento contínuo ao consumidor, mas deve nascer mensurada.

Registrar por loja, quando tecnicamente disponível:

- quantidade de operações;
- tokens de entrada e saída;
- custo estimado;
- erros e retries;
- modelo utilizado;
- taxa de fluxos aceitos/ativados.

Medidas de proteção:

- contexto mínimo necessário;
- saída estruturada;
- modelos de custo adequado quando a qualidade for suficiente;
- cache/reutilização quando fizer sentido;
- política interna de uso justo;
- proteção contra abuso.

A referência de **50 a 100 operações por loja/mês** permanece apenas como hipótese inicial de proteção. Não é uma franquia comercial definida e deverá ser recalibrada com dados reais.

---

## 13. Critérios de aceite futuros

A Rush IA só estará pronta quando:

- [ ] compreender solicitações comuns em português;
- [ ] consultar/obedecer ao Capability Registry;
- [ ] não inventar recursos inexistentes;
- [ ] produzir AI Draft estruturado;
- [ ] compilar o draft para o contrato oficial vigente;
- [ ] validar o payload no backend;
- [ ] lidar de forma segura com pedidos ambíguos ou impossíveis;
- [ ] apresentar o fluxo visualmente antes da ativação;
- [ ] permitir edição manual;
- [ ] exigir confirmação explícita;
- [ ] registrar uso/custo por loja;
- [ ] possuir proteção contra abuso;
- [ ] não enviar PII desnecessária nem segredos ao modelo;
- [ ] possuir testes das jornadas realmente suportadas;
- [ ] manter o construtor manual funcional mesmo com indisponibilidade da IA.

---

## 14. Jornadas de teste

Os testes definitivos serão derivados do Capability Registry vigente.

Exemplos de intenções para teste, **quando os recursos correspondentes existirem no motor**:

1. recompra após determinado período;
2. pós-venda após pedido enviado;
3. ação para SKU/produto específico;
4. ação baseada no valor do pedido;
5. recuperação de cliente inativo;
6. fluxo multicanal WhatsApp + e-mail;
7. solicitação contendo uma capacidade inexistente, para validar que a IA recusa ou propõe alternativa em vez de inventar.

---

## 15. Métricas de produto

Após a futura liberação, acompanhar:

- adoção da IA versus modo manual;
- percentual de drafts que viram fluxos ativados;
- quantidade média de ajustes manuais;
- erros de interpretação;
- pedidos recusados por capacidade inexistente;
- custo médio de IA por loja/mês;
- chamadas por loja;
- tempo até a primeira automação ativa;
- retenção de usuários que utilizam a Rush IA;
- automações mais solicitadas.

Métrica central sugerida:

**tempo até a primeira automação ativa.**

---

## 16. Ordem oficial de execução

### AGORA — prioridade de produto

1. concluir correções e hardening atuais;
2. estabilizar NubeSDK;
3. validar Local Mode/loja demo quando aplicável;
4. concluir requisitos e testes de homologação Nuvemshop;
5. publicar/estabilizar o Nuvem Rush;
6. confirmar funcionamento do produto principal.

### DEPOIS — Rush IA

1. reauditar os contratos oficiais do motor;
2. congelar/registrar o Capability Registry inicial;
3. definir AI Draft e compiler/adapter;
4. escolher provedor/modelo e política de custo;
5. implementar criação assistida;
6. testar segurança e jornadas;
7. liberar gradualmente.

---

## 17. Decisão final registrada

**Rush IA é viável e permanece aprovada como evolução do Nuvem Rush, mas está deliberadamente em espera.**

Não implementar durante a fase atual de estabilização/homologação.

Quando o Nuvem Rush estiver homologado e tecnicamente estável, este documento deverá ser reaberto e confrontado com os tipos, capacidades, políticas e integrações que existirem naquele momento antes do início da implementação.
