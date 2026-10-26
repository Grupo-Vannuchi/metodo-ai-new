# MCP de leitura do MétodoAI — desenho

Data: 2026-10-22 · Branch: `feature/mcp-leitura` (a partir de `origin/main` 14f0cd4 — a `dev`
está 197 commits atrás; decisão minha). A lista de exclusão abaixo foi levantada num schema
anterior: **reauditar contra o `schema.prisma` atual** (e-mail SMTP/Google, caixa de entrada etc.)
antes de implementar.

## Intenção

O mantenedor do MétodoAI quer perguntar ao Claude sobre os dados de **qualquer empresa** da
plataforma — perguntas soltas ("quantos leads entraram este mês na empresa X?") e relatórios com
totais calculados — sem abrir a aplicação nem o banco. Já existe um conector "METODO AI" cadastrado
no claude.ai apontando para `https://metodotia.com/api/mcp`, que hoje responde 404. Este trabalho
faz esse endereço virar um servidor MCP de verdade.

## Objetivos

- Servidor MCP em `src/app/api/mcp/` respondendo em `https://metodotia.com/api/mcp`.
- Usuário único: quem tem a chave. Enxerga **todas as organizações**.
- **Só leitura.** Nenhuma ferramenta cria, altera, apaga ou envia nada (WhatsApp, e-mail, webhook).
- Cobre **todos os módulos**: CRM, Financeiro, RH, Suprimentos, Marketing, Inbox, IA, Tarefas
  (Downloader não guarda dados de negócio relevantes — decisão do construtor se expõe algo).
- Dois tipos de ferramenta: **busca/listagem com filtros** e **resumos com totais**.

## Não-objetivos

- Acesso para clientes do MétodoIA ou login por usuário (OAuth). Não há multiusuário.
- Tela de Configurações para gerar/gerenciar chaves. Não há conceito de "dono da plataforma".
- Escrita de qualquer tipo.

## Anti-objetivos (falha mesmo se "funcionar")

- Vazar dado sensível (lista abaixo) por qualquer ferramenta, inclusive via campo aninhado/`include`.
- Endpoint acessível sem chave, ou chave comparada de forma não constante, ou chave em log.
- Consulta que derrube o banco de produção (sem limite de linhas / sem paginação).

## Decisões do usuário

- Quem usa: só ele. Escopo: todas as empresas.
- Autenticação: **uma chave aleatória** que só quem conecta usa (sem tela de gestão).
- Endereço: o que o conector "METODO AI" já usa (`/api/mcp`).
- **Ficam de fora** (confirmado): conteúdo de mensagens do WhatsApp, corpo de e-mails, salários do
  RH, credenciais.
- Formato: busca com filtros **e** relatórios com totais.
- Folha nos totais do Financeiro: entra como **uma única linha somada "Folha de pagamento"**, sem
  valor por pessoa, para os totais baterem com a tela do Financeiro.

## Restrições do repo

- Next 16.3.6, Node 20 (Hostinger/Passenger, build `next build --webpack`). `/api/*` não passa pelo
  `proxy.ts` — a rota se autentica sozinha (guia 05).
- SDK MCP não está instalado. Adicionar `@modelcontextprotocol/sdk` (compatível com zod 3 do repo).
  Se o SDK ler arquivos em runtime, conferir `outputFileTracingIncludes` (ver memória do build).
- Cada merge na `main` reinicia o Passenger: usar **Streamable HTTP sem sessão (stateless), resposta
  JSON** — nada de SSE de longa duração.
- Variáveis de ambiente só via `src/lib/env.ts` (zod).
- Prisma: `new PrismaClient` sempre com adapter (usar o `prisma` de `src/lib/prisma.ts`).
- Multi-tenancy: aqui é **contexto de sistema** (lê várias orgs). Regra do CLAUDE.md: Prisma cru só
  com `organizationId` explícito. Toda ferramenta de módulo **exige** `organizationId` e o passa a
  `tenantDb(orgId)` ou ao filtro. Só a ferramenta de listar organizações é global.
- Atualizar o guia 05 (nova rota pública e como se protege) no mesmo commit. Rodar as 5 checagens.

## Autenticação

- Nova env `MCP_API_KEY` (opcional no zod; **ausente ⇒ rota responde 404/401 sempre** — fail closed,
  igual `cron-auth.ts`). Valor: ≥ 32 bytes aleatórios (gerar com `openssl rand -hex 32` ou Node
  `crypto.randomBytes`). Configurar no hPanel e no `.env` local.
- Comparação em tempo constante (reaproveitar o padrão de `src/lib/cron-auth.ts`).
- Aceitar a chave por **dois caminhos** (decisão minha, porque o formulário de conector
  personalizado do claude.ai não garante campo de cabeçalho):
  1. `Authorization: Bearer <chave>`;
  2. segmento secreto na URL: `/api/mcp/<chave>` (rota dinâmica). O conector do claude.ai seria
     atualizado para essa URL.
  Nunca registrar a URL completa/chave em log.
- Compatibilidade com o conector do claude.ai (decisão minha): servidor **sem OAuth**. Chave
  errada ou ausente responde **404** (não 401 — o claude.ai trata 401 como "inicie OAuth"); não
  expor `/.well-known/oauth-*`. Primeiro teste real do formato URL-com-chave contra o claude.ai
  deve acontecer cedo; se o claude.ai recusar, parar e voltar ao usuário (é replanejamento).
- Rate limit com `makeRateLimiter` (`src/lib/ratelimit.ts`), ex.: 60 req/min. Sem Redis ⇒ permite
  (comportamento atual do helper).
- Auditoria: decisão minha — **não** gravar em `AuditLog` (é por organização e aparece na tela de
  auditoria do cliente). Em vez disso `console.info` com nome da ferramenta, orgId e duração
  (vai para os logs do hPanel), sem argumentos de busca livre.

## Ferramentas (proposta — o construtor pode ajustar nomes e granularidade)

Convenções: todas recebem `organizationId` (exceto as de organização); listagens têm `limit`
(padrão 50, máx 200) e `cursor`/`offset`; datas em ISO; valores Decimal devolvidos como string;
filtros de período `from`/`to`. Descrições das ferramentas em português.

**Plataforma**
- `listar_organizacoes` — id, nome, slug, dono (nome/e-mail), criada em, módulos ACTIVE/DORMANT,
  contagem de membros. Filtro por nome.
- `resumo_organizacao` — contagens por módulo (contatos, empresas, oportunidades abertas, tarefas
  abertas, funcionários ativos, itens de estoque…).

**CRM** — `buscar_empresas`, `buscar_contatos` (e-mail/telefone de contato **entram**: são dados de
negócio, não estão na lista de exclusão), `buscar_oportunidades` (funil, etapa, status, dono,
período), `buscar_propostas`, `resumo_vendas` (por período: criadas, ganhas, perdidas, valor,
conversão por etapa, por vendedor; metas × realizado).
**Financeiro** — `buscar_lancamentos`, `resumo_financeiro` (receitas/despesas, pago × pendente,
por categoria, vencidos). Lançamentos com `employeeId` ou `payrollRunId` (folha) **nunca aparecem
um a um** em `buscar_lancamentos`. Em `resumo_financeiro` (inclusive pago × pendente, vencidos e
quebra por categoria) eles entram **somados numa única linha "Folha de pagamento"** por período —
sem valor por pessoa, sem nome de funcionário, independente da categoria original (decisão do
usuário). A soma vem de `FinanceEntry`, não de `PayrollRun`/`PayrollItem`. Risco aceito: em
empresa com 1–2 funcionários essa linha se aproxima de um salário individual.
**RH** — `buscar_funcionarios` só com nome, cargo, departamento, status, admissão/desligamento;
`resumo_rh` (headcount, admissões, desligamentos, férias/ausências). **Nada** de salário, folha,
dados bancários, PIX, CPF, endereço, nascimento, motivo de desligamento, documentos.
**Suprimentos** — `buscar_itens_estoque` (saldo, mínimo, abaixo do ponto de pedido),
`buscar_movimentacoes`, `buscar_pedidos_compra`, `buscar_ativos`, `resumo_suprimentos`.
**Marketing** — `buscar_campanhas` e `buscar_disparos_email` com status e métricas
(enviados/entregues/lidos/falhas) — **sem** `html`, assinatura, corpo de template.
**Inbox** — `resumo_conversas` (por conexão, não lidas, atribuídas, volume por período) — **sem**
`Message.body`, `quotedBody`, `mediaUrl`, `lastMessagePreview`.
**IA** — no máximo metadados (agentes configurados, modelo); sem `prompt` nem conteúdo do assistente.
**Tarefas** — `buscar_tarefas` (status, prioridade, responsável, vencidas), `resumo_tarefas`.

## Lista de exclusão (nunca sai pelo MCP)

`Message.body/quotedBody/mediaUrl`, `Conversation.lastMessagePreview`, `WebhookEvent.payload`,
`WhatsappAgent.prompt`, `EmailBroadcast.html/signatureHtml/signatureText/audience`,
`MessageTemplate.body`, `EmailSignature.html`, `AssistantMessage.content`, `TeamChatMessage.body`,
`Feed*.body`, `Employee.baseSalary/bankName/bankBranch/bankAccount/pixKey/document/address/birthDate/terminationReason`,
`PayrollRun`, `PayrollItem`, `PayrollLine`, `FinanceEntry` ligados a funcionário/folha (um a um —
só entram somados na linha "Folha de pagamento" dos totais),
`EmployeeDocument.url`, `User.passwordHash`, `AuthToken`, `Invitation.tokenHash`,
`IntegrationConnection.credentialsEnc`, `EmailSenderAccount.credentials`, `WebhookEndpoint.secret`,
`ExtractionJob.pageToken`, `UserProfile.document/phone/address/birthDate`.

Implementação: toda consulta usa `select` explícito (nunca devolver o objeto Prisma inteiro nem
`include` sem `select`). Recomendo uma função de verificação (script em `scripts/`) que chame cada
ferramenta numa org local e falhe se algum nome de campo da lista aparecer na saída.

## Deixado ao construtor

- Reaproveitar funções de `src/lib/queries/` quando o retorno já for seguro; senão escrever
  consultas próprias em `src/lib/mcp/` com `select` explícito.
- Estrutura de arquivos, nomes finais das ferramentas, paginação exata.
- Se `DORMANT` deve esconder dados: decisão minha — **não** esconder (dado continua existindo);
  `listar_organizacoes` mostra o status para o usuário julgar.

## Verificação

- Local: `curl` com/sem chave (401), `tools/list`, chamada de cada ferramenta contra o Postgres do
  Docker; script de exclusão de campos sensíveis passando.
- As 5 checagens do CLAUDE.md.
- Teste de conexão antes do merge: Claude Code apontando para `http://localhost:3000/api/mcp` com a
  chave no cabeçalho.
- Fim do trabalho = branch publicado + link de PR (padrão do repo). **O merge na `main` só acontece
  com OK explícito do usuário na hora** (decisão minha: merge publica em produção).
- Produção (após o OK): definir `MCP_API_KEY` no hPanel **antes** do merge; depois atualizar a URL
  do conector no claude.ai e perguntar algo real.
