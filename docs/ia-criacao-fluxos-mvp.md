# Nuvem Rush — IA Criadora de Fluxos no MVP

**Data da decisão:** 13/08/2026  
**Status:** aprovado para planejamento do MVP  
**Objetivo:** tornar a criação de automações simples para lojistas pequenos e intermediários da Nuvemshop, sem exigir conhecimento técnico sobre gatilhos, condições, delays, WhatsApp, e-mail ou jornadas.

---

## 1. Decisão de produto

Incluir no MVP do Nuvem Rush uma camada de IA que permita ao lojista descrever, em linguagem natural, o que deseja automatizar.

A IA não será um agente com liberdade total sobre a loja. No MVP, ela funcionará como uma **criadora assistida de fluxos**, usando apenas os componentes e regras previamente suportados pelo motor do Nuvem Rush.

O princípio será:

> **O lojista diz o que quer fazer. O Nuvem Rush monta o fluxo. O lojista revisa e confirma antes de ativar.**

A criação manual continuará disponível para usuários que desejarem controle total.

---

## 2. Experiência esperada

Na tela de criação de automação, oferecer duas entradas:

### Configurar manualmente

O lojista escolhe gatilhos, condições, tempos de espera e ações.

### Criar com IA

O lojista escreve algo como:

> Quero tentar recuperar clientes que compraram café e não voltaram a comprar depois de 30 dias.

A IA pode propor:

1. Gatilho: pedido pago.
2. Condição: categoria = Café.
3. Esperar 30 dias.
4. Verificar se ocorreu nova compra.
5. Se não comprou, enviar WhatsApp.
6. Esperar 3 dias.
7. Verificar novamente.
8. Se ainda não comprou, enviar e-mail.
9. Encerrar o fluxo.

Antes da ativação, mostrar ao usuário uma tela de revisão com a mensagem:

> **Criei esta automação para você. Revise antes de ativar.**

A IA nunca deverá ativar um novo fluxo automaticamente no MVP sem confirmação explícita do lojista.

---

## 3. Escopo técnico da IA no MVP

A IA deverá converter linguagem natural em uma estrutura de fluxo válida e previsível.

Ela só poderá utilizar blocos existentes no motor de automação, por exemplo:

- pedido criado;
- pedido pago;
- pedido enviado;
- pedido entregue, quando houver dado confiável disponível;
- carrinho abandonado dentro das possibilidades fornecidas pela integração Nuvemshop;
- filtro por produto;
- filtro por SKU;
- filtro por categoria;
- filtro por marca, quando disponível;
- filtro por valor do pedido;
- filtro por tipo/segmento de cliente;
- espera em minutos, horas ou dias;
- verificar recompra;
- enviar template aprovado de WhatsApp;
- enviar e-mail;
- aplicar ou sugerir cupom quando o recurso estiver disponível;
- encerrar jornada.

A IA não deve inventar gatilhos, dados ou ações que o backend não suporte.

### Estrutura recomendada

Fluxo conceitual:

`pedido do lojista -> IA -> JSON estruturado -> validador Nuvem Rush -> preview visual -> confirmação -> persistência/ativação`

Exemplo simplificado:

```json
{
  "trigger": "ORDER_PAID",
  "conditions": [
    { "type": "CATEGORY", "operator": "EQUALS", "value": "cafe" }
  ],
  "steps": [
    { "type": "DELAY", "days": 30 },
    { "type": "CHECK_REPURCHASE" },
    { "type": "WHATSAPP_TEMPLATE", "when": "NO_REPURCHASE" },
    { "type": "DELAY", "days": 3 },
    { "type": "CHECK_REPURCHASE" },
    { "type": "EMAIL", "when": "NO_REPURCHASE" }
  ]
}
```

O JSON retornado pela IA deve obrigatoriamente passar por validação no backend. Nunca confiar diretamente na saída do modelo.

---

## 4. Segunda função recomendada: sugestões de automação

Depois da primeira versão de "Criar com IA", adicionar uma função leve de recomendação, provisoriamente chamada **Rush IA**.

Exemplo:

> Qual automação você recomenda para minha loja?

A IA poderá analisar somente dados e indicadores autorizados e disponíveis no Nuvem Rush e sugerir jornadas compatíveis com os recursos do produto.

Exemplo de resposta:

> Você vende produtos com potencial de recompra. Posso criar uma jornada para clientes que não voltarem a comprar após 30 dias.

A sugestão deve possuir uma ação clara como **Criar essa automação**, mas continuar exigindo revisão e confirmação antes de ativar.

Essa recomendação pode entrar no MVP somente se não atrasar o lançamento. A prioridade é a conversão de pedido em linguagem natural para fluxo estruturado.

---

## 5. Posicionamento do produto

Evitar posicionar o recurso apenas como "ChatGPT dentro do Nuvem Rush".

Nome de trabalho recomendado:

- **Rush IA**

Mensagem principal possível:

> **Você diz o que quer automatizar. O Nuvem Rush monta o fluxo para você.**

A proposta de valor passa a ser baseada não apenas em quantidade de automações, mas principalmente em facilidade de configuração para o pequeno e médio lojista.

O WhatsApp e o e-mail devem ser tratados como canais dentro das jornadas, e não como o produto inteiro.

---

## 6. Estratégia de preço

### Proposta de lançamento

**Nuvem Rush: R$ 59,90/mês**

Incluir no valor:

- motor de automações;
- jornadas de pós-venda;
- recuperação e recompra dentro das capacidades da integração;
- segmentações disponíveis;
- WhatsApp oficial;
- e-mail;
- Rush IA para criação assistida de fluxos;
- recursos previstos no plano de lançamento.

Não criar, inicialmente, uma cobrança visível separada como "R$ 39,90 + R$ 20 de IA".

Para o lojista, a IA é uma funcionalidade incluída na assinatura do Nuvem Rush. Custos internos de modelo, infraestrutura e processamento fazem parte da estrutura operacional do produto e não precisam ser discriminados comercialmente.

### Estratégia para primeiros clientes

Proposta a validar financeiramente:

- primeiros 100 lojistas: **R$ 59,90/mês**;
- posteriormente: referência de **R$ 89,90/mês** para novos clientes;
- possibilidade de manter o preço de fundador para os primeiros clientes enquanto permanecerem assinantes, desde que a margem real permita;
- período gratuito inicial pode ser usado conforme estratégia comercial vigente.

Com 100 clientes a R$ 59,90, a receita bruta recorrente seria de **R$ 5.990/mês**, antes de impostos, gateway, infraestrutura, suporte, IA e demais custos.

---

## 7. Controle de custo da IA

A IA de criação de fluxos tende a ter uso muito menor do que uma IA de atendimento ao consumidor, pois é acionada principalmente durante criação, alteração e recomendação de automações.

Mesmo assim, o sistema deve nascer com métricas e limites de proteção.

### Regras recomendadas

- registrar quantidade de chamadas por loja;
- registrar tokens de entrada e saída quando o provedor disponibilizar;
- registrar custo estimado por loja;
- limitar tamanho do contexto enviado ao modelo;
- enviar somente informações necessárias para montar o fluxo;
- preferir modelos de menor custo para tarefas estruturadas quando a qualidade for suficiente;
- utilizar saída estruturada/JSON;
- implementar cache ou reutilização quando aplicável;
- estabelecer política interna de uso justo.

Referência inicial de proteção: **50 a 100 operações de IA por loja/mês**, sem necessariamente apresentar esse limite como franquia comercial no lançamento. O valor definitivo deverá ser definido após observar o uso real e os custos do modelo escolhido.

Não assumir projeções de custo por IA como definitivas antes de medir prompts, tokens, modelo e comportamento dos primeiros usuários.

---

## 8. Segurança e previsibilidade

Requisitos obrigatórios:

1. A IA não ativa automações sem confirmação do usuário no MVP.
2. A IA só usa tipos de gatilho, condição e ação registrados no sistema.
3. Toda saída passa por schema/validador no backend.
4. Parâmetros inválidos são rejeitados antes de criar o fluxo.
5. Templates de WhatsApp precisam respeitar as regras aplicáveis da WhatsApp Business Platform.
6. Não permitir que texto gerado pelo modelo contorne regras de opt-out, consentimento ou bloqueios internos.
7. Manter logs de criação e alteração de fluxos.
8. Permitir que o lojista veja claramente o que acontecerá antes de ativar.
9. Não enviar ao modelo dados pessoais desnecessários de consumidores.
10. Prever fallback para criação manual quando a IA não entender o pedido.

---

## 9. Ordem de prioridade para implementação

### P0 — obrigatório para o produto

- motor de automações estável;
- integração Nuvemshop necessária aos gatilhos suportados;
- WhatsApp oficial;
- e-mail;
- persistência e execução confiável das jornadas;
- logs e tratamento de falhas.

### P1 — IA para o MVP

- botão **Criar com IA**;
- campo em linguagem natural;
- conversão para JSON/schema do Nuvem Rush;
- validação no backend;
- preview visual do fluxo;
- edição manual após criação pela IA;
- confirmação antes da ativação;
- telemetria de uso e custo.

### P2 — evolução após a primeira versão

- **Pergunte à Rush IA**;
- sugestões de jornadas com base na loja;
- análise de desempenho dos fluxos;
- sugestões de otimização;
- identificação de clientes/segmentos com potencial de recompra;
- criação de variações de fluxo;
- recomendações orientadas a resultado.

A implementação de P2 não deve atrasar o lançamento inicial.

---

## 10. Critérios de aceite do recurso "Criar com IA"

O recurso estará pronto para MVP quando:

- [ ] um lojista conseguir descrever uma automação em português comum;
- [ ] a IA retornar somente componentes suportados pelo Nuvem Rush;
- [ ] o retorno seguir um schema estruturado e validável;
- [ ] entradas inválidas ou ambíguas gerarem pedido de ajuste, e não fluxo perigoso;
- [ ] o fluxo for apresentado visualmente antes da ativação;
- [ ] o lojista puder editar manualmente o fluxo sugerido;
- [ ] nenhuma automação seja ativada sem confirmação explícita;
- [ ] chamadas e custos de IA sejam registrados por loja;
- [ ] exista proteção contra uso anormal/abusivo;
- [ ] existam testes para os principais tipos de jornada;
- [ ] falha da IA não impeça o uso do construtor manual.

---

## 11. Jornadas mínimas para teste da IA

A IA deverá ser testada, no mínimo, com pedidos como:

1. **Recompra:** "Avise o cliente 30 dias depois que comprar cápsulas e, se não comprar novamente, mande um e-mail três dias depois."
2. **Pós-venda:** "Quando o pedido for enviado, mande uma mensagem com o acompanhamento e depois faça um contato de pós-venda."
3. **Produto específico:** "Quando alguém comprar o SKU X, espere 15 dias e ofereça o produto Y."
4. **Valor do pedido:** "Pedidos acima de R$ 300 devem receber uma mensagem especial depois da compra."
5. **Cliente inativo:** "Tente recuperar quem não compra há 60 dias."
6. **Fluxo multicanal:** "Primeiro WhatsApp; se não houver recompra, depois e-mail."

Os testes precisam validar tanto o entendimento da intenção quanto a geração de uma estrutura executável pelo motor.

---

## 12. Métricas para validar a decisão

Após o lançamento, acompanhar:

- percentual de usuários que escolhem IA versus modo manual;
- percentual de fluxos gerados pela IA que são efetivamente ativados;
- número médio de ajustes manuais após geração;
- erros de interpretação;
- custo médio de IA por loja/mês;
- quantidade média de chamadas por loja;
- tempo entre cadastro e primeira automação ativa;
- retenção dos usuários que utilizaram a IA versus os que não utilizaram;
- automações mais solicitadas em linguagem natural.

Uma das principais métricas de produto deve ser **tempo até a primeira automação ativa**. A Rush IA deve reduzir esse tempo significativamente para usuários iniciantes.

---

## 13. Direção estratégica

O diferencial desejado para o Nuvem Rush não deve ser somente possuir muitos recursos. A vantagem deve estar em transformar uma plataforma tecnicamente poderosa em uma experiência simples para o lojista Nuvemshop.

Direção resumida:

> **Motor avançado por baixo, experiência simples por cima.**

O pequeno lojista não precisa conhecer webhooks, APIs, triggers, delays ou regras técnicas. Ele informa o objetivo comercial e o Nuvem Rush traduz esse objetivo em uma jornada que pode ser revisada e ativada.

Essa decisão deve ser considerada nas próximas etapas de arquitetura, UI/UX, backlog e posicionamento comercial do Nuvem Rush.
