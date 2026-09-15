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
import type { ModoAutonomia, Sessao } from '../shared/types';

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

function montarPrompt(sessao: Sessao): string {
  const cfg = getConfig();
  const modo = modoEfetivo();
  const cred = cfg.alvo.urlBase ? cofre.paraUrl(cfg.alvo.urlBase) : undefined;

  return [
    'Você opera um LMS (ambiente virtual de aprendizagem) por dentro de um navegador real,',
    'em nome do dono desta máquina, na conta dele.',
    '',
    `## Alvo`,
    `- Plataforma: ${cfg.alvo.nome || '(sem nome)'}`,
    `- Domínio: ${cfg.alvo.urlBase || '(nenhum configurado)'}`,
    `- Login em: ${cfg.alvo.caminhoLogin || '/'}`,
    cred
      ? `- Cofre: há credencial para ${cred.dominio} (usuário "${cred.usuario}"). Use \`entrar\`. Você não vê a senha e não precisa dela.`
      : '- Cofre: NÃO há credencial para este domínio. Se cair numa tela de login, use `perguntar`.',
    '',
    '## Como você enxerga',
    'Você não vê a tela: você lê um instantâneo em texto da árvore de acessibilidade. Cada',
    'elemento acionável tem um `ref=e12` — é por ele que as ferramentas agem. Os refs são',
    'reatribuídos a cada instantâneo, então:',
    '- depois de qualquer coisa que mude a página, o instantâneo novo já vem na resposta da ferramenta;',
    '- se um ref falhar, chame `olhar` e use os refs novos. Nunca chute um ref.',
    '- `f1e7` significa "elemento e7 dentro do quadro embutido 1" (iframe). Muito conteúdo de',
    '  LMS vive em iframe — SCORM, H5P, vídeo. Trate igual.',
    'Use `capturar` só quando o texto não bastar (gráfico, figura, fórmula em imagem).',
    '',
    '## Regras do modo',
    REGRAS_POR_MODO[modo],
    '',
    '## Produzir entregáveis',
    'Além de operar o LMS, você escreve arquivos: `escrever_arquivo`, `ler_arquivo`,',
    '`listar_arquivos` e `baixar_anexo`. Eles alcançam APENAS a pasta `trabalhos/` — nada fora',
    'dela, nem o código desta aplicação.',
    '- Uma subpasta por atividade, com nome claro (ex.: `juncoes-tabelas/`).',
    '- Antes de escrever, leia o enunciado inteiro na página da atividade: critérios, formato',
    '  pedido, o que vale nota. Atividade tem rubrica; entregar bonito fora do pedido é zero.',
    '- Se houver material anexo (PDF, dataset, template), use `baixar_anexo`. PDF você não',
    '  consegue ler daqui — procure a versão em HTML na própria página antes de desistir.',
    '- Escreva sempre o arquivo COMPLETO: a ferramenta substitui, não acrescenta.',
    '- Ponha um `LEIA.md` em cada subpasta dizendo o que é cada arquivo, o que ficou pronto e',
    '  o que depende de informação que só o dono ou o grupo têm.',
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
    'Produza o que dá para produzir de verdade — o SQL, o código, a documentação, a estrutura —',
    'e no `LEIA.md` liste explicitamente o que ficou faltando e por quê. Um entregável honesto com',
    'lacunas marcadas vale mais que um completo com dado inventado: o dono precisa saber onde',
    'olhar antes de colocar o nome dele naquilo.',
    '',
    '## Como trabalhar',
    '1. Comece com `abrir` na área relevante do curso e leia de verdade antes de agir.',
    '2. Ao responder questões: leia o enunciado inteiro, e as alternativas inteiras, antes de',
    '   escolher. Se o instantâneo vier cortado, role. Alternativa parecida com a certa é',
    '   exatamente como questão de múltipla escolha te derruba.',
    '3. Se não souber uma resposta com confiança, diga isso em `anotar` e — se puder — use',
    '   o material do próprio curso para checar. Não invente convicção que você não tem.',
    '4. `clicar` é para navegar. `submeter` é para o que deixa marca. Não troque um pelo outro:',
    '   usar `clicar` num botão de envio para escapar da aprovação é quebra de confiança.',
    '5. Antes de `submeter`, escreva em `respostas` exatamente o que está sendo enviado. É esse',
    '   texto que o dono lê para decidir. Um resumo vago faz ele aprovar às cegas.',
    '6. Travou em captcha, 2FA ou qualquer coisa que exija um humano: `perguntar`. A janela do',
    '   navegador está aberta e o dono pode resolver na mão.',
    '',
    cfg.instrucoes.trim()
      ? `## Instruções do dono\n${cfg.instrucoes.trim()}`
      : '',
    '',
    '## Tarefa desta sessão',
    sessao.objetivo,
    '',
    'Ao terminar, responda com um relato curto: o que foi feito, o que ficou pendente e o que',
    'você não conseguiu concluir. Se algo deu errado, diga — relatório otimista não ajuda ninguém.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function criarSessao(objetivo: string): Promise<Sessao> {
  const sessao: Sessao = {
    id: genId('ses'),
    objetivo: objetivo.trim(),
    status: 'ociosa',
    modo: modoEfetivo(),
    urlAtual: null,
    passos: [],
    pendente: null,
    sessionId: null,
    resultado: null,
    criadaEm: agora(),
    atualizadaEm: agora(),
  };
  return createSessao(sessao);
}

/**
 * Roda a sessão. Não bloqueia quem chamou: a rota dispara e devolve na hora, e o
 * progresso chega na UI por SSE. Mesma regra do Jarvis — o painel nunca trava
 * esperando o agente.
 */
export function executar(sessaoId: string): void {
  if (emExecucao.has(sessaoId)) return;
  const ctrl = new AbortController();
  emExecucao.set(sessaoId, ctrl);
  void rodar(sessaoId, ctrl).finally(() => emExecucao.delete(sessaoId));
}

async function rodar(sessaoId: string, ctrl: AbortController): Promise<void> {
  const sessao = getSessao(sessaoId);
  if (!sessao) return;

  const cfg = getConfig();
  const modo = modoEfetivo();

  if (!cfg.alvo.urlBase.trim()) {
    await patchSessao(sessaoId, {
      status: 'erro',
      resultado: 'Nenhum domínio apontado. Configure o alvo antes de rodar.',
    });
    return;
  }

  await patchSessao(sessaoId, { status: 'rodando', modo });
  await appendPasso(sessaoId, 'status', `Sessão iniciada no modo "${modo}".`);

  const opcoes: Options = {
    systemPrompt: montarPrompt(sessao),
    mcpServers: { [SERVIDOR_MCP]: criarServidorLms(sessaoId) },
    allowedTools: FERRAMENTAS_LMS,
    // O agente opera o LMS, não a máquina: sem Bash, sem Edit, sem Read de disco.
    disallowedTools: ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Agent', 'Task', 'WebFetch'],
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

  try {
    for await (const msg of query({ prompt: sessao.objetivo, options: opcoes })) {
      switch (msg.type) {
        case 'system': {
          if (msg.subtype === 'init') {
            registrarOrigem(msg.apiKeySource as string);
            await patchSessao(sessaoId, { sessionId: msg.session_id });
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

  const abortada = ctrl.signal.aborted;
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
