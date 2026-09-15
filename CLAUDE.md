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

### A armadilha do `evaluate`

`coletarInstantaneo` é serializada para dentro da página **pelo seu próprio texto**. Duas coisas
quebram isso em silêncio, e as duas já morderam:

- Referenciar qualquer coisa do escopo do módulo (do outro lado só existe o texto da função).
- O `keepNames` do esbuild/tsx, que embrulha cada função em `__name(...)` — helper que não existe no
  browser. Por isso `fonteInstantaneo()` injeta um shim e **falha alto** se o transpilador passar a
  injetar outro helper, em vez de devolver instantâneo vazio.

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
