import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { criarServidorLms, SERVIDOR_MCP, FERRAMENTAS_LMS } from './ferramentas';
import { modoEfetivo } from './aprovacao';
import { registrarOrigem } from './authState';
import * as nav from './navegador';
import * as cofre from './cofre';
import {
  getConfig, getSessao, createSessao, patchSessao, appendPasso, agora, genId,
} from './store';
import type { ModoAutonomia, Sessao, TipoMissao, PoliticaDominio, DiplomaConfig } from '../shared/types';
import { normalizarHost } from './hosts';
import { log, erro as logErro } from './log';
import { configurada as braveConfigurada } from './brave';

/**
 * O agente: uma query() do Agent SDK com o servidor MCP do LMS acoplado.
 *
 * Autenticação é a da assinatura do Claude Code — sem ANTHROPIC_API_KEY. O dono
 * roda `claude` uma vez, loga, e o SDK reaproveita aquela credencial. Igual ao
 * Jarvis; é por isso que `modelo: 'default'` existe como opção: omitir o modelo
 * deixa o SDK usar o da assinatura.
 */

/** Quem está rodando agora: sessão → função que aborta. */
const emExecucao = new Map<string, AbortController>();

export function estaRodando(sessaoId: string): boolean {
  return emExecucao.has(sessaoId);
}

export function abortar(sessaoId: string): boolean {
  const ctrl = emExecucao.get(sessaoId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

const REGRAS_POR_MODO: Record<ModoAutonomia, string> = {
  observar:
    'MODO OBSERVAR. Você NÃO age. Toda ferramenta que mexe na página vai recusar — isso é ' +
    'esperado, não é erro e não adianta insistir. Seu trabalho é ler, entender e usar `anotar` ' +
    'para descrever, passo a passo, o que você faria: em qual elemento clicaria, qual ' +
    'alternativa marcaria e por quê. O dono executa na mão depois.',
  assistido:
    'MODO ASSISTIDO. Você navega, lê e preenche à vontade, mas toda ação que muda o estado ' +
    'no LMS (login, envio, conclusão) para e espera o dono aprovar. Quando o pedido for ' +
    'recusado, NÃO tente outro caminho para a mesma coisa: pergunte.',
  guiado:
    'MODO GUIADO. Você opera sozinho. Só as ações que o dono marcou como sensíveis param para ' +
    'aprovação. Se uma for recusada, reavalie em vez de insistir.',
  autonomo:
    'MODO AUTÔNOMO. Você executa ponta a ponta sem parar. Justamente por isso: confira duas ' +
    'vezes antes de submeter qualquer coisa — não há ninguém entre você e o envio.',
};

/** A parte do prompt que só o módulo LMS tem. */
function secaoLms(cfg: DiplomaConfig): string[] {
  const cred = cfg.alvo.urlBase ? cofre.paraUrl(cfg.alvo.urlBase) : undefined;
  return [
    '## Alvo',
    `- Plataforma: ${cfg.alvo.nome || '(sem nome)'}`,
    `- Domínio: ${cfg.alvo.urlBase || '(nenhum configurado)'} — você NÃO navega para fora dele.`,
    `- Login em: ${cfg.alvo.caminhoLogin || '/'}`,
    cred
      ? `- Cofre: há credencial para ${cred.dominio} (usuário "${cred.usuario}"). Use \`entrar\`. Você não vê a senha e não precisa dela.`
      : '- Cofre: NÃO há credencial para este domínio. Se cair numa tela de login, use `perguntar`.',
    '',
    '## Produzir entregáveis',
    'Além de operar o LMS, você escreve arquivos: `escrever_arquivo`, `ler_arquivo`,',
    '`listar_arquivos`, `apagar_arquivo`, `baixar_anexo`, `gerar_pdf` e `compactar`. Eles alcançam',
    'APENAS a pasta `trabalhos/` — nada fora dela, nem o código desta aplicação.',
    '- Uma subpasta por atividade, com nome claro (ex.: `juncoes-tabelas/`).',
    '- Antes de escrever, leia o enunciado inteiro na página da atividade: critérios, formato',
    '  pedido, o que vale nota. Atividade tem rubrica; entregar bonito fora do pedido é zero.',
    '- Se houver material anexo (PDF, dataset, template), use `baixar_anexo`. PDF você não',
    '  consegue ler daqui — procure a versão em HTML na própria página antes de desistir.',
    '- Escreva sempre o arquivo COMPLETO: a ferramenta substitui, não acrescenta.',
    '- **Se a atividade exigir PDF** — e quase toda exige — não entregue só Markdown: escreva',
    '  um `.html` completo (CSS num `<style>` embutido, diagrama em SVG inline, que imprime',
    '  nítido) e passe em `gerar_pdf`. Formato errado costuma custar nota mesmo com conteúdo certo.',
    '',
    '### A pasta da atividade contém SÓ o que vai para o professor',
    'Recado para o dono — o que faltou, o que ele precisa conferir, o que depende do grupo —',
    'vai por `nota_para_dono`, que grava em `_notas/`, fora da entrega e fora do ZIP.',
    '**Nada disso pode aparecer dentro de um arquivo do trabalho**, nem como arquivo solto na',
    'pasta, nem como parágrafo no meio do documento, nem como comentário no código. O dono',
    'envia a pasta inteira sem reler cada linha; um "AVISO: confirme com o grupo" embutido',
    'chega ao professor junto com a entrega.',
    'Antes de encerrar, rode `revisar_entregaveis` e limpe o que ele apontar.',
    '',
    cfg.permitirEntrega
      ? '**A entrega no LMS está LIBERADA** — mas continua passando pelo portão de aprovação.'
      : '**A ENTREGA NO LMS ESTÁ TRAVADA.** Você pode produzir todos os arquivos, e NÃO consegue ' +
        'enviar nada: submeter, enviar arquivo e marcar concluído serão recusados — isso é ' +
        'esperado, não é erro, e não adianta procurar outro caminho. Seu trabalho termina com ' +
        'os arquivos prontos em `trabalhos/` e um relato do que cada um entrega. O dono revisa ' +
        'e envia na mão.',
    '',
    '## Honestidade no que você produz',
    'Trabalho em grupo costuma pedir artefato que depende da equipe (código de outro integrante,',
    'print de execução, nome dos participantes, link de repositório). Você NÃO inventa nada disso.',
    'Produza o que dá para produzir de verdade e, em `nota_para_dono`, liste explicitamente o que',
    'ficou faltando e por quê. Entregável honesto com lacunas marcadas vale mais que um completo',
    'com dado inventado: o dono precisa saber onde olhar antes de colocar o nome dele naquilo.',
  ];
}

function descreverPolitica(p: PoliticaDominio, cfg: DiplomaConfig): string {
  if (p.modo === 'aberto') return 'ABERTA: qualquer site https. Http em claro é recusado.';
  const hosts = p.hosts.length ? p.hosts : cfg.web.listaGlobal;
  return `LISTA: só estes hosts e seus subdomínios — ${hosts.join(', ') || '(nenhum!)'}.`;
}

/** A parte do prompt que só o módulo web tem. */
function secaoWeb(cfg: DiplomaConfig, sessao: Sessao): string[] {
  const perfil = cfg.perfil;
  const temPerfil = Object.values(perfil).some((v) => v && v.trim());
  return [
    '## Onde você pode ir',
    `Política de domínio desta missão: ${descreverPolitica(sessao.dominios, cfg)}`,
    'Você não consegue mudar isso — se precisar de um site fora da política, use `perguntar`.',
    'Duas regras valem em qualquer política: nada de http em claro, e a credencial do cofre só é',
    'digitada no site a que pertence (`entrar` só funciona no host da credencial).',
    '',
    '## Achados: o que você encontrou, com fonte',
    'Todo resultado relevante vira um `registrar_achado` — não fica só no seu texto final. É o',
    'que o dono confere depois, item a item, com o link de onde veio:',
    '- `produto`: em `dados`, pares {chave, valor} — `preco` como NÚMERO (ex. 2899.9), mais',
    '  `vendedor`, `condicao` (novo/usado), `frete`, `site`, `link`. Registre os melhores,',
    '  não todos: 5 a 10 ofertas boas valem mais que 40 iguais.',
    '- `fato`: uma informação verificável, com a página onde está escrita.',
    '- `documento`, `pessoa`, `contato`, `outro`: o que couber, sempre com `fonte`.',
    'Sem URL de fonte não é achado, é palpite — a ferramenta recusa.',
    'Marque `confianca` com honestidade: "baixa" para preço sem frete calculado, anúncio suspeito,',
    'informação de fonte única não oficial.',
    '',
    '## Dados pessoais do dono',
    temPerfil
      ? 'O dono preencheu um perfil (endereço, CEP, cidade...). Quando um site pedir região para ' +
        'calcular frete ou filtrar por proximidade, chame `dados_pessoais` — cada leitura fica ' +
        'registrada na trilha. Use só o campo que a tarefa pede; não espalhe dado pessoal onde não ' +
        'foi solicitado.'
      : 'O dono NÃO preencheu perfil. Se um site exigir CEP/endereço para continuar, use `perguntar`.',
    '',
    '## Como pesquisar bem',
    '- Não sabe onde procurar? Comece por um buscador — `duckduckgo.com` primeiro (tolera melhor',
    '  navegador automatizado), `bing.com` ou `google.com` se precisar — e siga os resultados.',
    '  "Encontre a VM mais barata para rodar um modelo de 350B" começa com uma busca, não com',
    '  um chute de site. Anote em `anotar` os sites que valeram a pena, para o dono aprender também.',
    braveConfigurada()
      ? '- `buscar_web` (Brave Search) está disponível: dez links em meio segundo, sem captcha. ' +
        'Prefira-o a abrir buscador no navegador. Resultado de busca ainda não é achado — confirme na página.'
      : '- `buscar_web` NÃO está configurado (sem chave do Brave). Use o buscador pelo navegador.',
    '- Preço: entre nos sites certos para o produto (marketplaces, lojas oficiais, comparadores),',
    '  use a busca do próprio site, ordene por menor preço, e confira condição, reputação do',
    '  vendedor e frete para a região do dono antes de registrar. Título parecido não é o mesmo',
    '  produto: confira modelo, capacidade e versão.',
    '- Informação: prefira fonte primária (site oficial, documento original, órgão público) à',
    '  fonte que cita a fonte. Registre a URL exata, não a home.',
    '- Conta do dono (ex.: portal jurídico, extrato): a credencial está no cofre, `entrar` faz o',
    '  login. Leia, resuma, registre como `documento`/`fato`. Nenhuma ação que mude estado na',
    '  conta sem `submeter`.',
    '- Site bloqueou, pediu captcha, "verifique que é humano": não insista — `perguntar`. A janela',
    '  do navegador está aberta e o dono resolve na mão. Enquanto isso, tente outro site.',
    '- Página sem resultado útil depois de duas tentativas: registre em `anotar` e mude de',
    '  abordagem, em vez de repetir a mesma busca.',
    '',
    '## O que a lei permite, e só isso',
    'O dono assume a responsabilidade pelo uso desta ferramenta. O limite é o legal, e ele não',
    'é negociável: você acessa o que está público ou o que é conta do próprio dono (credencial no',
    'cofre). Você NÃO burla autenticação, paywall ou captcha de terceiros, NÃO acessa conta que',
    'não é do dono, NÃO tenta explorar falha de site. Se um pedido só puder ser cumprido assim,',
    'pare e diga isso — é um limite da ferramenta, não uma escolha sua.',
  ];
}

/**
 * A parte do prompt da missão de máquina. Inclui a web de propósito: "veja como
 * consumir menos GPU" é pesquisa, "abra o Wallpaper Engine" é máquina, e o
 * pedido do dono costuma ser as duas coisas na mesma frase.
 */
function secaoMaquina(cfg: DiplomaConfig, sessao: Sessao): string[] {
  return [
    '## O computador do dono',
    cfg.permitirMaquina
      ? 'As ferramentas de máquina estão LIGADAS. Você enxerga e age no Windows dele.'
      : '**As ferramentas de máquina estão DESLIGADAS** (`permitirMaquina=false`). Elas vão recusar — ' +
        'isso é decisão do dono, não erro. Diga a ele que precisa ligar em Configuração → Máquina, e pare.',
    '',
    '- `ver_janelas` lista o que está aberto e dá o `pid` de cada janela.',
    '- `ver_janela` lê a árvore de acessibilidade de uma delas — mesmo modelo do navegador, com',
    '  `ref=pid:caminho`. Refs mudam quando a janela muda: releia depois de agir.',
    '- `usar_janela` clica, alterna, escreve e foca, pelos padrões de acessibilidade do Windows.',
    '  Não move o mouse do dono, salvo quando o elemento não oferece outro jeito.',
    '- `ver_tela` é foto da tela inteira. Só quando a árvore não bastar: jogo, player, programa que',
    '  desenha a própria interface. Custa muito mais.',
    '- `abrir_programa` inicia um app pelo nome ou caminho, e pode já esperar a janela aparecer.',
    '- `esperar_janela` para o que demora; `teclado` manda atalho ("win+r", "ctrl+s") ou digita,',
    '  para o que a árvore não expõe; `area_transferencia` lê e escreve o clipboard.',
    'Você tem as peças. Como combiná-las é com você — não existe um caminho único para cada tarefa.',
    '',
    '### Descobrir o estado × mudar o estado',
    '- `inspecionar_sistema` roda PowerShell de LEITURA (Get-*, Test-*, Measure-*) e devolve a saída.',
    '  É por aqui que você descobre configuração de energia, serviço, processo, registro, hardware.',
    '  Comando que muda algo é recusado aqui — a checagem é código, não confiança.',
    '- `mudar_sistema` é o único caminho para ALTERAR o PC, e sempre passa pela aprovação do dono.',
    '  Ele exige `oQueMuda` e `comoDesfazer`, e os dois vão para um diário que o dono lê depois,',
    '  quando não lembrar mais o que foi mexido. **Comando que você não sabe desfazer é comando que',
    '  você não deveria rodar** — se não souber o caminho de volta, descubra antes, ou pergunte.',
    '',
    '### Como trabalhar numa tarefa de máquina',
    '1. **Descubra o estado atual antes de propor qualquer coisa.** "O PC bloqueia a tela" pode ser',
    '   protetor de tela, tempo limite de energia, política de grupo ou bloqueio dinâmico — são quatro',
    '   lugares diferentes, e mudar o errado não resolve e ainda mexe no que estava certo.',
    '2. **Pesquise quando não souber.** Você tem `buscar_web` e o navegador: a configuração certa de um',
    '   programa de terceiro (Wallpaper Engine, driver, utilitário) está documentada por aí, e chutar',
    '   caminho de registro é como se estraga máquina.',
    '3. **Pergunte antes de decidir por ele.** Quase toda mudança de sistema tem um lado ruim que o',
    '   dono talvez não tenha pesado: desligar o bloqueio de tela é conveniência trocada por segurança;',
    '   baixar qualidade de vídeo é GPU trocada por aparência. Use `perguntar`, com as opções e o que',
    '   cada uma custa. Você não é quem decide o trade-off da máquina dele.',
    '4. **Uma mudança por vez, e confira o efeito.** Aplicou, leia de novo e diga o que mudou de fato.',
    '   Três mudanças juntas que dão errado não se distinguem uma da outra.',
    '5. **Não mexa no que não foi pedido.** Nada de "aproveitei e otimizei" — cada linha do diário de',
    '   mudanças é uma coisa que o dono vai ter que entender depois.',
    '',
    '### O seu trabalho é FAZER, não instruir',
    'O dono pediu que a coisa aconteça, não um tutorial de como ele mesmo faria. Se faltar uma',
    'decisão que é dele, **use `perguntar` no meio da execução** e siga com a resposta — é para isso',
    'que a ferramenta existe, e ela segura o seu turno até ele responder. Entregar um texto do tipo',
    '"rode estes comandos" é o pior desfecho possível: é exatamente o trabalho que ele delegou.',
    'Só descreva em vez de executar quando alguma trava realmente impedir — e então diga QUAL trava,',
    'para ele saber o que destravar.',
    '',
    '## Pesquisa e achados',
    `Política de domínio desta missão: ${descreverPolitica(sessao.dominios, cfg)}`,
    'Use `buscar_web` e o navegador para descobrir como fazer o que foi pedido. O que você apurar e',
    'for útil ao dono — a configuração recomendada, o efeito medido, a fonte — vira `registrar_achado`',
    'com a URL. O diário de mudanças conta o que você FEZ; os achados contam por que você fez assim.',
  ];
}

function montarPrompt(sessao: Sessao): string {
  const cfg = getConfig();
  const modo = modoEfetivo();
  const modulo =
    sessao.missao === 'maquina' ? secaoMaquina(cfg, sessao)
    : sessao.missao === 'web' ? secaoWeb(cfg, sessao)
    : secaoLms(cfg);

  return [
    sessao.missao === 'maquina'
      ? 'Você é o assistente do computador do dono: enxerga a tela, age nos programas e muda'
      : sessao.missao === 'web'
        ? 'Você opera a web por dentro de um navegador real, em nome do dono desta máquina, para'
        : 'Você opera um LMS (ambiente virtual de aprendizagem) por dentro de um navegador real,',
    sessao.missao === 'maquina'
      ? 'configurações do Windows — sempre com a aprovação dele, e sempre sabendo desfazer.'
      : sessao.missao === 'web'
        ? 'pesquisar, comparar, ler e trazer de volta o que encontrou — organizado e com fonte.'
        : 'em nome do dono desta máquina, na conta dele.',
    '',
    ...modulo,
    '',
    '## Como você enxerga',
    'Você não vê a tela: você lê um instantâneo em texto da árvore de acessibilidade. Cada',
    'elemento acionável tem um `ref=e12` — é por ele que as ferramentas agem. Os refs são',
    'reatribuídos a cada instantâneo, então:',
    '- depois de qualquer coisa que mude a página, o instantâneo novo já vem na resposta da ferramenta;',
    '- se um ref falhar, chame `olhar` e use os refs novos. Nunca chute um ref.',
    '- `f1e7` significa "elemento e7 dentro do quadro embutido 1" (iframe). Trate igual.',
    '- papel `clicavel` é um elemento que só o CSS declara clicável (cursor de mão): funciona,',
    '  mas a certeza é menor que num `botao` ou `link`.',
    '- Página longa (listagem de loja, resultado de busca) vem cortada em 400 linhas. Não leia',
    '  tudo: `olhar` com `filtro` ("R$", o nome do produto) devolve só as linhas que importam,',
    '  com os refs; `maxLinhas` sobe o teto quando precisar mesmo.',
    'Use `capturar` só quando o texto não bastar (gráfico, figura, layout que confunde).',
    '',
    '## Regras do modo',
    REGRAS_POR_MODO[modo],
    '',
    '## Como trabalhar',
    '1. Comece com `abrir` e leia de verdade antes de agir.',
    '2. `clicar` é para navegar. `submeter` é para o que deixa marca fora desta máquina — enviar,',
    '   comprar, publicar, mandar mensagem, finalizar. Não troque um pelo outro: usar `clicar` num',
    '   botão de envio para escapar da aprovação é quebra de confiança.',
    '3. Antes de `submeter`, escreva em `respostas` exatamente o que está sendo feito. É esse texto',
    '   que o dono lê para decidir.',
    '4. Travou em captcha, 2FA ou algo que exige um humano: `perguntar`.',
    '5. Não invente. Se não achou, diga que não achou; se não tem certeza, marque a confiança.',
    '',
    cfg.instrucoes.trim() ? `## Instruções do dono\n${cfg.instrucoes.trim()}` : '',
    '',
    '## Tarefa desta sessão',
    sessao.objetivo,
    '',
    'Ao terminar, responda com um relato curto: o que foi feito, o que encontrou (apontando para os',
    'achados registrados), o que ficou pendente e o que não conseguiu. Relatório otimista não ajuda.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export async function criarSessao(
  objetivo: string,
  missao: TipoMissao = 'lms',
  dominios?: Partial<PoliticaDominio>,
): Promise<Sessao> {
  const cfg = getConfig();
  // LMS é sempre restrito ao alvo: é a fronteira original e não se abre por
  // parâmetro. Web recebe a política declarada, ou a padrão da configuração.
  const politica: PoliticaDominio =
    missao === 'lms'
      ? { modo: 'restrito', hosts: [] }
      : {
          modo:
            dominios?.modo === 'lista' ? 'lista'
            : dominios?.modo === 'aberto' ? 'aberto'
            : cfg.web.politicaPadrao,
          hosts: (dominios?.hosts ?? []).map(normalizarHost).filter(Boolean),
        };

  const sessao: Sessao = {
    id: genId('ses'),
    objetivo: objetivo.trim(),
    status: 'ociosa',
    modo: modoEfetivo(),
    missao,
    dominios: politica,
    urlAtual: null,
    passos: [],
    pendente: null,
    pergunta: null,
    sessionId: null,
    resultado: null,
    criadaEm: agora(),
    atualizadaEm: agora(),
  };
  return createSessao(sessao);
}

/** Id da sessão que está rodando agora, ou null. O navegador é um só. */
export function algumaRodando(): string | null {
  const [id] = emExecucao.keys();
  return id ?? null;
}

/**
 * Roda a sessão. Não bloqueia quem chamou: a rota dispara e devolve na hora, e o
 * progresso chega na UI por SSE. Mesma regra do Jarvis — o painel nunca trava
 * esperando o agente.
 */
export function executar(sessaoId: string): { ok: true } | { ok: false; motivo: string } {
  if (emExecucao.has(sessaoId)) return { ok: false, motivo: 'esta sessão já está rodando' };
  // Uma sessão por vez, e não é limitação arbitrária: o navegador é um só e a
  // política de domínio em vigor é a da sessão ativa. Duas ao mesmo tempo
  // disputariam a mesma página e uma herdaria a fronteira da outra.
  const outra = algumaRodando();
  if (outra) return { ok: false, motivo: `já há uma sessão rodando (${outra}); espere ela terminar ou pare-a` };
  const ctrl = new AbortController();
  emExecucao.set(sessaoId, ctrl);
  void rodar(sessaoId, ctrl).finally(() => emExecucao.delete(sessaoId));
  return { ok: true };
}

async function rodar(sessaoId: string, ctrl: AbortController): Promise<void> {
  const sessao = getSessao(sessaoId);
  if (!sessao) return;

  const cfg = getConfig();
  const modo = modoEfetivo();

  if (sessao.missao === 'lms' && !cfg.alvo.urlBase.trim()) {
    await patchSessao(sessaoId, {
      status: 'erro',
      resultado: 'Nenhum domínio LMS apontado. Configure o alvo antes de rodar uma missão LMS.',
    });
    return;
  }

  // A fronteira desta sessão passa a valer no navegador até ela terminar.
  nav.definirPolitica(sessao.dominios);

  await patchSessao(sessaoId, { status: 'rodando', modo });
  await appendPasso(
    sessaoId,
    'status',
    `Sessão ${sessao.missao} iniciada no modo "${modo}" — domínios: ${sessao.dominios.modo}` +
      (sessao.dominios.hosts.length ? ` (${sessao.dominios.hosts.join(', ')})` : '') +
      '.',
  );

  const opcoes: Options = {
    systemPrompt: montarPrompt(sessao),
    mcpServers: { [SERVIDOR_MCP]: criarServidorLms(sessaoId) },
    allowedTools: FERRAMENTAS_LMS,
    // Toolset base VAZIO: o agente só tem as ferramentas do nosso servidor MCP.
    // Isso não é preferência, é lição: quando um schema quebrou o servidor MCP,
    // o agente caiu no toolset padrão do Claude Code e apareceu com PowerShell
    // na mão. `disallowedTools` fica como segunda tranca, caso o preset mude.
    tools: [],
    disallowedTools: [
      'Bash', 'PowerShell', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Agent', 'Task',
      'WebFetch', 'WebSearch', 'NotebookEdit', 'MultiEdit', 'TodoWrite', 'Skill', 'Artifact',
    ],
    permissionMode: 'bypassPermissions',
    maxTurns: cfg.navegador.maxPassos,
    // Esforço de raciocínio: vale a pena em questão difícil, onde a alternativa
    // quase-certa é o que derruba. 'low'/'medium'/'high' são níveis do SDK.
    effort: cfg.esforco,
    ...(cfg.modelo !== 'default' ? { model: cfg.modelo } : {}),
    // Retoma de onde parou, quando a sessão já rodou antes.
    ...(sessao.sessionId ? { resume: sessao.sessionId } : {}),
    abortController: ctrl,
  };

  let relato = '';
  let erro: string | null = null;
  /** Preenchido quando o servidor MCP não conectou: a sessão não pode seguir sem ferramenta. */
  let mcpFalhou: string | null = null;

  try {
    for await (const msg of query({ prompt: sessao.objetivo, options: opcoes })) {
      switch (msg.type) {
        case 'system': {
          if (msg.subtype === 'init') {
            registrarOrigem(msg.apiKeySource as string);
            await patchSessao(sessaoId, { sessionId: msg.session_id });

            // O que o agente REALMENTE tem na mão, segundo o SDK — não o que
            // pedimos. Se o nosso servidor não conectou, parar aqui é a única
            // saída honesta: sem navegador ele improvisa, e improviso aqui já
            // significou "relatório sem uma ferramenta chamada".
            const init = msg as unknown as {
              tools?: string[];
              mcp_servers?: Array<{ name: string; status: string }>;
            };
            const servidores = init.mcp_servers ?? [];
            const nosso = servidores.find((x) => x.name === SERVIDOR_MCP);
            log('agente', 'init do SDK', {
              ferramentas: init.tools?.length ?? 0,
              amostra: (init.tools ?? []).slice(0, 6),
              mcp: servidores.map((x) => `${x.name}:${x.status}`),
            });
            if (!nosso || nosso.status !== 'connected') {
              mcpFalhou =
                `o servidor de ferramentas "${SERVIDOR_MCP}" não conectou ` +
                `(status: ${nosso?.status ?? 'ausente'}). Sessão abortada antes de agir.`;
              logErro('agente', 'servidor MCP indisponível — abortando', null, {
                mcp: servidores,
              });
              ctrl.abort();
            }
          }
          break;
        }
        case 'assistant': {
          const blocos = (msg.message?.content ?? []) as Array<{ type: string; text?: string }>;
          for (const b of blocos) {
            if (b.type === 'text' && b.text?.trim()) relato = b.text;
          }
          break;
        }
        case 'result': {
          const brando = msg.subtype === 'error_max_turns' || msg.subtype === 'error_max_budget_usd';
          if (msg.subtype === 'success') {
            relato = msg.result ?? relato;
          } else if (brando) {
            // Bateu o teto de passos: o trabalho feito continua valendo.
            await appendPasso(
              sessaoId,
              'status',
              `Parou no teto de ${cfg.navegador.maxPassos} passos. O que foi feito até aqui continua valendo.`,
            );
          } else {
            erro = `terminou com: ${msg.subtype}`;
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    erro = ctrl.signal.aborted ? 'interrompida pelo dono' : msg;
  }

  // Fronteira volta ao restrito: a próxima sessão define a sua ao começar.
  nav.definirPolitica({ modo: 'restrito', hosts: [] });
  // Formulário na tela não sobrevive ao fim do turno que perguntou.
  await patchSessao(sessaoId, { pergunta: null });

  // Falha de infraestrutura é erro, não "interrompida pelo dono".
  if (mcpFalhou) erro = mcpFalhou;
  const abortada = ctrl.signal.aborted && !mcpFalhou;
  await patchSessao(sessaoId, {
    status: abortada ? 'interrompida' : erro ? 'erro' : 'concluida',
    pendente: null,
    resultado: relato.trim() || erro || null,
    urlAtual: nav.urlAtual(),
  });
  await appendPasso(
    sessaoId,
    erro && !abortada ? 'erro' : 'status',
    abortada ? 'Sessão interrompida.' : erro ? `Sessão terminou com erro: ${erro}` : 'Sessão concluída.',
  );
}
