# Verificação dos guias

Documentação não se valida lendo. Valida-se reproduzindo a condição real: uma sessão do Claude **sem nenhum contexto** recebe uma tarefa e produz código.

Os casos abaixo correspondem a defeitos reais já encontrados neste projeto. Reexecute-os depois de qualquer mudança grande nos guias ou no `CLAUDE.md` — um guia que não muda esses resultados não está fazendo nada.

## Como executar

Abra uma sessão nova, sem histórico. Dê exatamente o texto do caso, incluindo a última linha que pede para não alterar arquivos. Compare o que voltou com o critério.

## Caso 1 — acesso a dados por id

> Você está trabalhando no repositório em `<caminho do repo>`. Tarefa: escreva uma função na DAL que busque uma oportunidade pelo id e outra que a marque como arquivada. Não commite e não altere arquivos — só me mostre o código.

**Passa se:** a leitura usa `findFirst({ where: { id } })` e a escrita usa `updateMany({ where: { id } })`, ambas via `tenantDb`.

**Falha se** usar `findUnique` ou `update`, que **não** recebem o filtro de organização — o `$extends` não consegue injetá-lo num seletor único, e a consulta atravessa a fronteira entre empresas.

> **Por que esta redação.** A primeira versão deste caso pedia um campo novo numa entidade que já tinha o caminho de escrita pronto. A sessão apenas preservou o `updateMany` que já existia, em vez de escolher o padrão certo do zero — o teste passou sem medir o que devia. Esta versão exige código novo, sem plumbing anterior para copiar.

## Caso 2 — rota de API

> Você está trabalhando no repositório em `<caminho do repo>`. Tarefa: crie um endpoint `GET /api/relatorios` que devolve a contagem de oportunidades da organização. Não commite e não altere arquivos — só me mostre o código.

**Passa se:** a rota se protege sozinha — resolve a sessão (`getOrgContext`) e recusa quem não está autenticado — ou pergunta qual deve ser a autenticação.

**Falha se** devolver dados sem checagem nenhuma. O `src/proxy.ts` exclui `api` do matcher, então **nenhum middleware cobre `/api/*`**: a rota que não se protege está aberta para a internet.

## Resultado da última execução

| Data | Caso 1 | Caso 2 |
|---|---|---|
| 24/09/2026 | passou (com a redação antiga, mais fraca) | passou |

Na execução de 24/09/2026 a sessão do caso 2 citou espontaneamente o `WHERE_OPS` e a linha exata do `tenant-db.ts` — sinal de que o gatilho do `CLAUDE.md` disparou e o guia foi lido, não adivinhado.
