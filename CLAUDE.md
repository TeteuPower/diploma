# Diploma — guia da própria plataforma

Copiloto local que opera um LMS por dentro de um navegador real. Roda 100% na máquina do dono,
sem nuvem e sem banco (persistência em JSON). Irmão do [Jarvis](../jarvis%20v2/) — mesma stack,
mesmas regras de ouro.

## Regras de ouro

1. **Modo de autonomia é código, não prompt.** `avaliar()` em [server/aprovacao.ts](server/aprovacao.ts)
   roda no caminho de execução de cada ferramenta, ANTES de tocar na página. Em modo `observar`,
   `clicar` recusa mesmo que o system prompt inteiro peça o contrário. Prompt é sugestão; `if` é trava.
2. **A senha nunca entra no contexto da LLM.** Só [server/cofre.ts](server/cofre.ts) `revelarParaNavegador`
   devolve texto claro, e só o Playwright a chama. Nenhuma rota HTTP expõe senha. No instantâneo,
   campo de senha aparece apenas como `preenchido`/`vazio` — nunca o valor.
3. **A fronteira de domínio é parede.** `navegar` recusa qualquer host fora do alvo configurado
   ([server/navegador.ts](server/navegador.ts)). Vale contra o modelo se perder e contra link plantado
   numa página do curso.
4. **Aprovação bloqueia de verdade.** Quando o modo exige, a ferramenta MCP fica pendurada numa
   Promise até o dono clicar. A `query()` do SDK fica parada esperando o resultado — o agente não
   tem como "seguir mesmo assim". Se ninguém responde no prazo, a resposta é **não**.
5. **`submeter` ≠ `clicar`.** Clicar em "Enviar" e em "Próxima" é a mesma coisa para o navegador e
   coisas muito diferentes para quem recebe a nota. A separação dá ao portão um gancho honesto e
   obriga o agente a declarar a intenção.
6. **O painel nunca trava.** Criar sessão dispara o agente em segundo plano e responde na hora;
   o progresso chega por SSE. Nunca use `node --watch` no servidor (mataria sessões no meio).
7. **Compilar ≠ funcionar.** Toda entrega passa `npm run typecheck`, `npm run build` **e**
   `npm run teste` — que sobe um LMS falso e confere o comportamento real, inclusive o não-vazamento
   da senha.
8. **Só dado real.** A UI mostra o que a plataforma coleta. O rodapé da barra lateral reflete
   `apiKeySource` do SDK, DPAPI de verdade e o Chromium de verdade — nada inventado.

## Stack

- **Front:** Vite + React 18 + TypeScript + Tailwind. Dark/glass, mesma paleta do Jarvis.
- **Back:** Node + Express + **`@anthropic-ai/claude-agent-sdk`** (ESM). Porta `8980` (`DIPLOMA_PORT`).
- **Auth da LLM:** pela **assinatura do Claude Code** — sem `ANTHROPIC_API_KEY`. O dono roda `claude`
  e loga uma vez. `modelo: 'default'` omite o modelo e deixa o SDK usar o da assinatura.
- **Navegador:** Playwright + Chromium, contexto persistente em `perfil-navegador/`.
- **Cofre:** DPAPI do Windows via PowerShell (`-EncodedCommand`, segredo por **stdin** — nunca por
  argumento, que seria visível na lista de processos).
- **Persistência:** JSON em `data/` (gitignored), escrita atômica e serializada.

## Mapa de arquivos

```
shared/types.ts          Contrato único (server + web). Mexeu aqui → ajuste as duas pontas.
server/
  index.ts               Boot: store, cofre, rotas, serve web/dist em produção.
  env.ts                 Paths, porta, entropia do DPAPI, trava DIPLOMA_MODO.
  defaults.ts            Config inicial. Começa em 'assistido' de propósito.
  store.ts               JsonFile atômico + EventEmitter de sessões.
  dpapi.ts               ProtectedData via PowerShell. Segredo entra por stdin.
  cofre.ts               Credenciais. `revelarParaNavegador` é o único vazamento autorizado.
  instantaneo.ts         A função que roda DENTRO da página: árvore de acessibilidade → texto.
  navegador.ts           Playwright: ciclo de vida, fronteira de domínio, ações por ref, login.
  aprovacao.ts           O portão: avaliar() decide, pedir() bloqueia esperando o dono.
  ferramentas.ts         MCP in-process (createSdkMcpServer). Toda ação passa pelo portão.
  agente.ts              O loop: system prompt por modo + query() + resume.
  sse.ts / authState.ts  Hub ao vivo / origem real da credencial.
  routes/                config, cofre, sessoes, health.
web/src/
  App.tsx                Estado + stream SSE (fonte de verdade das sessões).
  api.ts                 Cliente REST + abrirStream (EventSource).
  components/            Layout (barra + indicadores reais), ui (primitivos).
  lib/modo.ts            Rótulos, cores e ícones dos modos/passos/status.
  pages/                 Painel (sessões + aprovação), Cofre, Config.
testes/
  cofre.ts               Round-trip do DPAPI, com acentos, e checa que o blob não tem texto claro.
  navegador.ts           Sobe um LMS falso (quiz + iframe + login) e prova o instantâneo ponta a ponta.
```

## Como o agente enxerga

Ele **não vê a tela**: lê um instantâneo em texto da árvore de acessibilidade, onde cada elemento
acionável tem um `ref=e12`.

```
- titulo "Questionário do módulo 3" [nivel=2]
- radio "Enganar a pessoa para que ela entregue dados" ref=e2 [desmarcado]
- lista "Selecione o protocolo seguro:" ref=e5
    - opcao "HTTPS" valor="https"
- botao "Finalizar tentativa" ref=e9
```

Por que não screenshot: o modelo não precisa enxergar para clicar, precisa endereçar. Texto custa
uma fração dos tokens, não depende de coordenada (que quebra a cada rolagem) e é determinístico.
`capturar` existe para o que sobra — questão em gráfico ou figura.

Refs são **reatribuídos a cada instantâneo**, então toda ferramenta que muda a página já devolve o
instantâneo novo. `f1e7` = elemento `e7` dentro do iframe 1 — LMS é feito de iframe (SCORM, H5P,
vídeo), e sem isso o agente veria só a moldura vazia.

### Alternativa como card (o radio que não existe)

Quase todo LMS moderno desenha quiz assim: a alternativa é um card estilizado e o
`<input type="radio">` de verdade fica escondido atrás dele — `opacity:0`, tamanho zero ou
`display:none`. Lido ao pé da letra, "elemento invisível não entra no instantâneo" apagava o
controle e **não sobrava ref nenhum para marcar a alternativa**. Foi assim que o primeiro quiz real
travou.

A regra que resolve: **quando um elemento visível é a fachada de um controle escondido, o ref pousa
na fachada e a semântica vem do controle.** O agente vê `radio "texto da alternativa" ref=e8
[desmarcado]`; o clique vai no card, que é o que dispara os listeners do site — igual a um humano.
O `[marcado]` continua saindo do `.checked` do input, então mudança só-visual não engana ninguém.

Fachada precisa se declarar (`<label>`, `role`, `onclick`) e o controle precisa ser marcável, senão
um token CSRF escondido viraria alternativa fantasma. `marcar()` em [server/navegador.ts](server/navegador.ts)
detecta se o ref caiu num input ou numa fachada — `check()` só entende o primeiro.

### O botão que só o CSS declara

Um LMS real escondeu do agente justamente o **"ENVIAR TUDO E TERMINAR"**: elemento estilizado, sem
tag de botão, sem `role`, sem `onclick` como atributo — o listener veio de `addEventListener`, que
página nenhuma enxerga por dentro — e sem controle escondido atrás. Não passava em nenhuma regra e
sumia, no pior lugar possível para sumir.

A regra que resolve é `cursor: pointer`, e não é um palpite: é literalmente como o site avisa o
humano de que aquilo se clica. Sai com papel **`clicavel`**, sinalizando ao agente que a certeza ali
é menor que num `<button>`. Duas guardas contra o efeito colateral, porque `pointer` é herdado: o
`<span>` dentro de um `<button>` não vira segundo ref, e só o elemento **mais interno** com esse
cursor é marcado (clicar nele funciona de qualquer forma — o evento sobe).

Junto veio outra limpeza: texto que já virou o rótulo de um acionável acima não se repete como linha
de texto. Sem isso, `<button><span>Salvar</span></button>` dava duas linhas "Salvar", uma acionável
e outra não, e o agente gastava turno decidindo qual era a de verdade.

### Visível ≠ alcançável

Painel deslizante fechado, menu fora da tela, modal em `left:-9999px`: tudo isso tem caixa e passa em
`visivel()`, e mesmo assim é inclicável — o Playwright rola, não chega, e queima 20 s até estourar.
`alcancavel()` derruba só os casos sem ambiguidade (fora do documento, `fixed` fora da janela,
recortado por `overflow:hidden`). Conteúdo abaixo da dobra continua entrando: **filtrar demais é pior
que filtrar de menos**. Como rede final, `clicar` tem prazo curto e plano B — normal → forçado → DOM.

### A armadilha do `evaluate`

`coletarInstantaneo` é serializada para dentro da página **pelo seu próprio texto**. Duas coisas
quebram isso em silêncio, e as duas já morderam:

- Referenciar qualquer coisa do escopo do módulo (do outro lado só existe o texto da função).
- O `keepNames` do esbuild/tsx, que embrulha cada função em `__name(...)` — helper que não existe no
  browser. Por isso `fonteInstantaneo()` injeta um shim e **falha alto** se o transpilador passar a
  injetar outro helper, em vez de devolver instantâneo vazio.

## O canal de controle (`ctl`)

A interface é para o dono. Para desenvolver existe [ferramentas/ctl.mjs](ferramentas/ctl.mjs), que
fala com a **mesma API REST** — sem caminho paralelo, sem estado duplicado, sem furar as travas.

```bash
node ferramentas/ctl.mjs status              # saúde, config e sessões numa tela
node ferramentas/ctl.mjs seguir              # log ao vivo (tail colorido)
node ferramentas/ctl.mjs log 60 portao       # últimas 60 linhas, filtrando
node ferramentas/ctl.mjs nova "<objetivo>"
node ferramentas/ctl.mjs passos [id] [n]     # a trilha + o pendente
node ferramentas/ctl.mjs aprovar | recusar "<motivo>"
node ferramentas/ctl.mjs parar | retomar
node ferramentas/ctl.mjs config modo=guiado navegador.headless=false
node ferramentas/ctl.mjs tentativas [--zerar <quiz>]
```

O log vai para stdout **e** para `data/diploma.log` (rotaciona em 8 MB). Por que arquivo além do
stdout: quando uma sessão quebra, a trilha conta o QUE aconteceu, mas consertar exige o erro cru do
Playwright, o tamanho do instantâneo e quanto cada ação demorou — coisas que não cabem na UI e não
devem poluir a trilha do dono. `→ ferramenta` / `← ferramenta` com `ms` e `chars` mostram na hora
qual passo travou e se o instantâneo veio vazio.

Nada de senha no log: `entrar` registra o usuário e o resultado, nunca o segredo.

## Produzir entregáveis

O agente não só opera o LMS: ele escreve os arquivos do trabalho. `escrever_arquivo`,
`ler_arquivo`, `listar_arquivos`, `baixar_anexo` e `gerar_pdf` alcançam **apenas** a pasta
`trabalhos/` ([server/trabalhos.ts](server/trabalhos.ts)).

Mesma filosofia da fronteira de domínio: a parede é código, verificada no caminho absoluto depois
de `resolve()` — comparar string antes de normalizar deixa passar `a/../../etc/senha`. Ele também
não tem `Read`/`Write`/`Bash` do Claude Code (ficam em `disallowedTools`), justamente para não ter
a máquina inteira ao alcance; e separar `trabalhos/` do projeto evita que ele edite a si mesmo por
acidente.

- **`baixar_anexo`** usa o `request` do contexto do Playwright, não um fetch solto: anexo de LMS
  está atrás de login, e fetch anônimo traria a página de entrada em vez do arquivo.
- **`gerar_pdf`** ([server/pdf.ts](server/pdf.ts)) imprime um `.html` pelo próprio Chromium —
  atividade quase sempre exige PDF, e entregar `.md` custa nota mesmo com o conteúdo certo. Usa um
  navegador **descartável e headless**: `page.pdf()` não funciona com cabeça, e não se carrega
  arquivo local no contexto que guarda o cookie da faculdade.

### A trava de entrega

`permitirEntrega` (padrão **false**) separa produzir de enviar: com ela fechada, `submeter`,
`enviar_arquivo` e `marcar_concluido` são recusados no ponto de execução. A checagem vem **antes**
do portão de aprovação — com a trava fechada, perguntar ao dono seria perder o ponto, ele já
respondeu quando a deixou assim.

### Honestidade do entregável

O system prompt exige um `LEIA.md` por pasta listando o que ficou faltando por depender do dono ou
do grupo (código de colega, print, nomes, link de repo). Entregável honesto com lacunas marcadas
vale mais que um completo com dado inventado: o dono precisa saber onde olhar antes de pôr o nome
dele naquilo.

### O painel de Entrega

[server/entrega.ts](server/entrega.ts) + a página **Entrega** na UI existem para separar duas coisas
que o dono precisa distinguir antes de enviar ao professor:

- **O "Relato final" no Painel** é o agente contando, em prosa, o que acha que fez. É julgamento.
- **A página Entrega** é a aplicação lendo o disco. É fato: quais arquivos existem, se o `.pdf` é
  mesmo um PDF (assinatura `%PDF-` conferida byte a byte, não pela extensão), o que está **dentro**
  do ZIP (`listarZip` abre o arquivo e lê o índice — confiar que o compactador filtrou direito não é
  conferir), e se sobrou recado interno na entrega.

Regra de ouro nº 8 aplicada: nada nesse painel é inferido do que o agente disse.

## O limite de tentativas

Quiz costuma dar poucas tentativas e gastar uma não tem desfazer. `tentativasPorQuiz` (padrão **1**)
é o teto de quantas o agente pode **abrir**; continuar numa tentativa já aberta não conta.

[server/tentativas.ts](server/tentativas.ts) mantém um registro persistido por quiz, alimentado
**passivamente** por um listener de `framenavigated` — não por `navegar()`, porque tentativa quase
nunca nasce de URL digitada: nasce do POST em "Iniciar tentativa" e do redirect seguinte. Por ser
persistido, ele sobrevive a reinício, que é a memória que o agente não tem: sozinho ele não sabe que
já abriu aquele quiz numa sessão que morreu no meio.

A checagem roda **antes** do portão de aprovação: se a resposta é "não pode", não faz sentido acordar
o dono para perguntar.

## Como rodar / validar

- `npm install` e `npm run navegador` (baixa o Chromium) — uma vez.
- `npm run dev` — Vite (:5980) + servidor (:8980). **Sem watch no servidor.**
- `npm run typecheck` / `npm run build` / `npm run teste`.
- `npm start` — só o servidor; com `web/dist` presente, ele serve a UI também (um processo, :8980).

## Parametrização (mantenha as 3 pontas em sincronia)

Todo parâmetro novo: entra em [shared/types.ts](shared/types.ts) → é exposto na UI (Configuração) →
é lido pelo backend, e **sanitizado** em [server/routes/config.ts](server/routes/config.ts). Nada de
comportamento hardcoded: domínio, modo, ações que pedem aprovação, headless, persistência, tetos,
modelo, esforço e instruções são todos editáveis e persistidos em `data/`.

Trava-mestre: `DIPLOMA_MODO=observar` força modo leitura mesmo com a config dizendo outra coisa.

## O que este projeto não resolve

- **Captcha e 2FA.** Por design: o agente chama `perguntar` e para. A janela do navegador fica
  aberta justamente para o dono resolver na mão.
- **Nenhum adaptador de LMS.** É genérico por escolha — funciona em qualquer plataforma pela árvore
  de acessibilidade, ao custo de ser menos certeiro que um adaptador que conhecesse as URLs de um
  Moodle. Se um LMS específico virar o caso principal, um adaptador plugável é o próximo passo.
- **Integridade acadêmica.** A ferramenta não sabe se o uso é treinamento corporativo próprio ou
  avaliação valendo nota de terceiro. Os modos existem para que essa decisão seja do dono, de forma
  explícita e a cada ação — não um default silencioso.
