# Documentação de ambientação para dev novo — design

**Data:** 2026-09-24 · **Status:** aprovado, aguardando implementação

---

## 1. Problema

Entra um desenvolvedor **júnior** para assumir o dia a dia de um código de **~64 mil linhas em ~550 arquivos**, substituindo quem escreveu **92% do histórico** (335 dos 362 commits), **sem repasse dele**.

Duas consequências que o desenho precisa levar a sério:

**O júnior vai depender do Claude para produzir — e não vai conseguir revisar o que o Claude produz.** Ele não terá como saber que `findUnique` escapa do `$extends` do `tenantDb`, ou que uma rota nova em `src/app/api/` nasce pública porque o `src/proxy.ts` exclui `api` do matcher. Esses dois não são hipóteses: em 24/09/2026 foram encontrados dois endpoints de cron sem autenticação nenhuma, um cron que apagaria posts fixados do mural, e três scripts que quebravam no boot. Nenhum seria pego por quem não conhece as armadilhas.

Ou seja: **a documentação é a camada de revisão que não vai existir.** Ela não é material de leitura — precisa fazer o Claude acertar por construção.

**O conhecimento não escrito se perdeu.** O que o autor anterior sabia e não documentou não volta. Parte do conteúdo será reconstrução a partir do código, dos comentários e do README, e precisa ser marcada como tal.

## 2. Objetivo

Que o Claude, na máquina do dev novo e **sem nenhum contexto prévio**, escreva código que respeita as fronteiras deste projeto — e que o dev consiga se localizar sozinho em ~550 arquivos.

**Critério de sucesso:** uma sessão nova recebe uma tarefa representativa ("adicione um campo X na entidade Y") e produz código que usa a DAL com `tenantDb`, no padrão `findFirst` + `updateMany`, sem que ninguém tenha avisado.

## 3. Restrições

- **O `CLAUDE.md` entra em todo turno.** Cada linha custa contexto em cada interação, para sempre. Engordá-lo é a solução errada.
- **O repositório é público.** Nada de credencial, estado de exposição em aberto, ou detalhe que sirva de mapa para atacante.
- **Idioma: português**, como o README, o `PLANO.md` e o `CLAUDE.md` atuais. Comentários de código seguem em inglês.
- **Documentação existente que não se toca:** o `README.md` é o handoff (arquitetura, runbook, incidentes) e o `PLANO.md` é histórico, já marcado como superado.

## 4. Desenho

### 4.1 O `CLAUDE.md` vira roteador

Ele deixa de tentar conter tudo e passa a **disparar a leitura certa na hora certa**, com linhas explícitas de gatilho:

```
- Vai escrever consulta ao banco? PARE e leia docs/guia/03-multi-tenancy.md antes.
- Vai criar rota em src/app/api/? PARE e leia docs/guia/05-rotas-e-jobs.md antes.
```

Funciona porque o `CLAUDE.md` está no contexto de todo turno: a instrução é vista antes de cada ação. Os guias carregam sob demanda, então uma sessão que mexe em CSS não paga o custo da documentação de multi-tenancy.

O que fica no `CLAUDE.md`: as regras invioláveis (já existentes), os comandos, o índice de gatilhos, e a regra de manutenção (§4.4). Sai dele qualquer coisa que só interesse a um tipo específico de tarefa.

### 4.2 Os seis guias, em `docs/guia/`

| Arquivo | Conteúdo | Por que existe |
|---|---|---|
| `01-primeiros-passos.md` | Sequência do primeiro dia: subir o ambiente, validar que funciona, executar a primeira tarefa de ponta a ponta | Júnior precisa de ordem, não de referência. O §5 do README ensina os comandos; este guia ensina o caminho. |
| `02-mapa-do-codigo.md` | Tabela "preciso mudar X, vou onde"; o que vive em cada pasta; os arquivos grandes e por que são grandes | 550 arquivos são inavegáveis sem mapa; o maior tem 1.646 linhas |
| `03-multi-tenancy.md` | A fronteira de segurança: o que o `tenantDb` cobre, **o que não cobre**, o padrão correto por id, como o `check:isolation` prova | É o único erro deste código que vaza dado de um cliente para outro |
| `04-modulos-e-permissoes.md` | Comprado × instalado, telas, features, templates de acesso, e o vocabulário do domínio | É o modelo de domínio inteiro, e o gating erra fácil |
| `05-rotas-e-jobs.md` | Rota de API nasce **pública**; o guard de cron; webhooks; filas | Foi daqui que saíram as duas vulnerabilidades reais encontradas |
| `06-antes-de-commitar.md` | O que cada uma das 5 validações pega e o que fazer quando cada uma falha | "Rode os cinco" sem entender o que significam vira ritual vazio |

Os três primeiros servem principalmente o humano se localizando; os três últimos servem principalmente o Claude não errando. Na prática todos servem aos dois.

### 4.3 Nenhum guia repete o README

O `README.md` segue sendo o handoff. Os guias são para **executar trabalho** e **apontam** para o README em vez de reescrevê-lo.

Isto não é preferência de estilo: duplicação é como documentação apodrece. Duas cópias divergem, e depois ninguém sabe qual vale. Quando um guia precisar de algo que já está no README, ele linka a seção.

### 4.4 Manutenção

Entra no `CLAUDE.md` a regra: **mexeu numa fonte de verdade, atualize o guia correspondente no mesmo commit.** As fontes de verdade e seus guias:

| Fonte de verdade | Guia |
|---|---|
| `src/lib/tenant-db.ts`, `src/lib/queries/` | `03-multi-tenancy.md` |
| `src/config/modules.ts`, `screens.ts`, `limits.ts` | `04-modulos-e-permissoes.md` |
| `src/lib/cron-auth.ts`, `src/proxy.ts`, `src/app/api/` | `05-rotas-e-jobs.md` |
| `package.json` (scripts de validação) | `06-antes-de-commitar.md` |

Não é automatizável, mas deixa explícito de quem é a responsabilidade — e um guia desatualizado é pior que nenhum, porque é seguido com confiança.

### 4.5 Marcação de origem

Onde o conteúdo for **inferência** a partir do código, e não fato verificado, o texto diz isso. Um guia que afirma com confiança algo deduzido é pior que um que avisa "isto parece ser assim, confirme antes de depender". O autor anterior saiu sem repasse; fingir certeza sobre a intenção dele engana quem chega.

## 5. Verificação

Documentação não se valida lendo. Valida-se com o teste que reproduz a condição real: **uma sessão nova do Claude, sem contexto, recebe uma tarefa e produz código.**

A implementação está completa quando, numa sessão sem histórico:

1. Pedir "adicione um campo de observações na entidade `Company`" produz acesso a dados via `tenantDb`, com `findFirst` + `updateMany` — e **não** `findUnique` + `update`.
2. Pedir "crie um endpoint em `/api/relatorios`" produz uma rota que se protege sozinha, ou que pergunta qual deve ser a autenticação — e **não** uma rota aberta.
3. Pedir "adicione uma tela ao módulo de Tarefas" leva o Claude a `src/config/modules.ts` e `src/config/screens.ts`, e a acrescentar a chave em `pt.json` **e** `en.json`.

Os três correspondem a defeitos reais já encontrados neste código. Um guia que não muda esses resultados não está fazendo nada.

## 6. Riscos

| Risco | Avaliação |
|---|---|
| Os guias apodrecem | Real e é o maior deles. Mitigação: a regra de manutenção do §4.4 e o princípio de não duplicar o README. Nenhuma das duas impede apodrecimento, apenas o torna mais lento e mais visível. |
| O Claude ignora os gatilhos do `CLAUDE.md` | Possível. Se acontecer, o caminho é promover os fluxos mais errados a skills de projeto em `.claude/skills/`, que disparam sozinhas. Deliberadamente **não** feito agora: adiciona mecanismo antes de haver evidência de que é preciso. |
| Seis arquivos é muito para um júnior ler | Eles não são para ler de uma vez. O `01` é o único de leitura sequencial; os outros são carregados pelo Claude quando a tarefa pede, ou consultados pelo humano quando surge a dúvida. |
| A reconstrução contém erro meu | Por isso o §4.5. Onde eu inferi, está marcado, e o dev sabe que precisa confirmar. |

## 7. Fora de escopo

- Skills de projeto em `.claude/skills/` — ver a linha correspondente no §6.
- Reescrever o `README.md` ou o `PLANO.md`.
- Documentar módulo a módulo (CRM, Financeiro, RH…). O `02-mapa-do-codigo.md` diz onde cada um vive; detalhar o comportamento de cada um é trabalho separado e provavelmente desnecessário — o código é a fonte.
- Suíte de testes. O projeto não tem nenhuma, e documentação não substitui isso.
