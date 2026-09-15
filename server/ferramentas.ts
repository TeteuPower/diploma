import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as nav from './navegador';
import * as cofre from './cofre';
import { avaliar, pedir } from './aprovacao';
import { appendPasso, getConfig } from './store';
import type { AcaoSensivel } from '../shared/types';

export const SERVIDOR_MCP = 'lms';

/** Resposta de ferramenta no formato que o SDK espera. */
type Conteudo = { content: Array<{ type: 'text'; text: string }> };
const texto = (t: string): Conteudo => ({ content: [{ type: 'text', text: t }] });

/**
 * As ferramentas que o agente tem para operar o LMS.
 *
 * Duas coisas valem ser ditas aqui, porque não se leem no código:
 *
 * 1. **Toda ação que muda estado passa por `avaliar()` ANTES de tocar na página.**
 *    O modo de autonomia não é instrução de prompt: é `if` no caminho de
 *    execução. Em modo "observar", `clicar` devolve uma recusa sem clicar —
 *    ainda que o prompt inteiro peça o contrário.
 *
 * 2. **`submeter` existe separada de `clicar` de propósito.** Clicar em "Enviar"
 *    e clicar em "Próxima página" são a mesma operação para o navegador e coisas
 *    muito diferentes para quem vai receber a nota. Separar dá ao portão de
 *    aprovação um gancho honesto, e obriga o agente a declarar a intenção.
 */
export function criarServidorLms(sessaoId: string) {
  /** Registra o passo e devolve o instantâneo novo — o agente sempre vê o agora. */
  async function comInstantaneo(resumo: string, ferramenta: string): Promise<Conteudo> {
    const url = nav.urlAtual() ?? undefined;
    await appendPasso(sessaoId, 'agiu', resumo, { ferramenta, url });
    return texto(await nav.instantaneo());
  }

  /** O caminho que toda ação sensível percorre. */
  async function portao(
    acao: AcaoSensivel | 'interacao',
    descricao: string,
    detalhe: string,
    executar: () => Promise<Conteudo>,
  ): Promise<Conteudo> {
    const veredito = avaliar(acao);

    if (veredito.tipo === 'recusado') {
      await appendPasso(sessaoId, 'recusado', `${descricao} — ${veredito.motivo}`);
      return texto(`AÇÃO NÃO EXECUTADA. ${veredito.motivo}`);
    }

    if (veredito.tipo === 'precisa-aprovacao') {
      const decisao = await pedir(sessaoId, acao as AcaoSensivel, descricao, detalhe);
      if (!decisao.aprovado) {
        return texto(
          `AÇÃO NÃO EXECUTADA — ${decisao.motivo}. ` +
            'Não tente de novo pelo mesmo caminho: reavalie ou pergunte ao dono.',
        );
      }
    }

    return executar();
  }

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  const abrir = tool(
    'abrir',
    'Abre o navegador e vai até uma URL do LMS. Aceita caminho relativo (/curso/123) ' +
      'ou URL completa. Só navega dentro do domínio configurado. Devolve o instantâneo da página.',
    { url: z.string().describe('URL completa ou caminho relativo dentro do LMS') },
    async ({ url }) => {
      try {
        await nav.navegar(url);
        await appendPasso(sessaoId, 'navegou', `Abriu ${url}`, {
          ferramenta: 'abrir',
          url: nav.urlAtual() ?? undefined,
        });
        return texto(await nav.instantaneo());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await appendPasso(sessaoId, 'erro', `Falha ao abrir ${url}: ${msg}`, { ferramenta: 'abrir' });
        return texto(`ERRO: ${msg}`);
      }
    },
  );

  const olhar = tool(
    'olhar',
    'Tira um instantâneo do que está na tela agora: a árvore de elementos com os refs ' +
      '(ref=e12) que você usa para agir. Use depois de qualquer mudança que você não causou.',
    {},
    async () => {
      try {
        const snap = await nav.instantaneo();
        await appendPasso(sessaoId, 'leu', 'Leu a página', {
          ferramenta: 'olhar',
          url: nav.urlAtual() ?? undefined,
        });
        return texto(snap);
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const capturar = tool(
    'capturar',
    'Tira uma foto da tela. Use SÓ quando o instantâneo de texto não basta — questão ' +
      'com gráfico, figura, fórmula em imagem. Custa muito mais que `olhar`.',
    { motivo: z.string().describe('Por que o texto não bastou aqui') },
    async ({ motivo }) => {
      try {
        const b64 = await nav.captura();
        await appendPasso(sessaoId, 'leu', `Capturou a tela: ${motivo}`, { ferramenta: 'capturar' });
        return {
          content: [
            { type: 'image' as const, data: b64, mimeType: 'image/jpeg' },
            { type: 'text' as const, text: `Captura de ${nav.urlAtual() ?? 'página atual'}.` },
          ],
        } as unknown as Conteudo;
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const rolar = tool(
    'rolar',
    'Rola a página. Conteúdo que estava fora da tela aparece no próximo instantâneo.',
    { direcao: z.enum(['baixo', 'cima', 'topo', 'fim']) },
    async ({ direcao }) => {
      try {
        await nav.rolar(direcao);
        return texto(await nav.instantaneo());
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const voltar = tool(
    'voltar',
    'Volta uma página no histórico do navegador.',
    {},
    async () => {
      try {
        await nav.voltar();
        await appendPasso(sessaoId, 'navegou', 'Voltou uma página', {
          ferramenta: 'voltar',
          url: nav.urlAtual() ?? undefined,
        });
        return texto(await nav.instantaneo());
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const esperar = tool(
    'esperar',
    'Espera um texto aparecer na tela (para carregamento lento, vídeo, upload). ' +
      'Devolve se apareceu dentro do prazo.',
    {
      texto: z.string().describe('Trecho de texto que deve aparecer'),
      segundos: z.number().min(1).max(120).default(15),
    },
    async ({ texto: alvo, segundos }) => {
      const achou = await nav.esperarTexto(alvo, segundos);
      return texto(
        achou
          ? `"${alvo}" apareceu.\n\n${await nav.instantaneo()}`
          : `"${alvo}" não apareceu em ${segundos}s.`,
      );
    },
  );

  // -------------------------------------------------------------------------
  // Ações que mudam a página
  // -------------------------------------------------------------------------

  const clicar = tool(
    'clicar',
    'Clica num elemento pelo ref do instantâneo. Para NAVEGAR e INTERAGIR — abrir uma ' +
      'seção, ir para a próxima página, expandir. NÃO use para enviar respostas nem ' +
      'finalizar tentativa: para isso existe `submeter`.',
    {
      ref: z.string().describe('O ref do instantâneo, ex.: e12 ou f1e7'),
      porque: z.string().describe('O que você espera que aconteça'),
    },
    ({ ref, porque }) =>
      portao('interacao', `Clicar em ${ref}: ${porque}`, `ref=${ref}`, async () => {
        try {
          await nav.clicar(ref);
          return comInstantaneo(`Clicou em ${ref} — ${porque}`, 'clicar');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await appendPasso(sessaoId, 'erro', `Clique em ${ref} falhou: ${msg}`, {
            ferramenta: 'clicar',
          });
          return texto(`ERRO: ${msg}. Tire um instantâneo novo — o ref pode ter mudado.`);
        }
      }),
  );

  const escrever = tool(
    'escrever',
    'Escreve num campo de texto pelo ref. Substitui o conteúdo que estiver lá. ' +
      'Nunca use para senha — use `entrar`.',
    {
      ref: z.string(),
      texto: z.string().describe('O conteúdo a escrever'),
    },
    ({ ref, texto: conteudo }) =>
      portao(
        'interacao',
        `Escrever em ${ref}`,
        conteudo.slice(0, 2000),
        async () => {
          try {
            await nav.preencher(ref, conteudo);
            return comInstantaneo(
              `Escreveu em ${ref}: "${conteudo.slice(0, 80)}${conteudo.length > 80 ? '…' : ''}"`,
              'escrever',
            );
          } catch (err) {
            return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      ),
  );

  const escolher = tool(
    'escolher',
    'Marca uma alternativa (radio/checkbox) ou escolhe numa lista suspensa.',
    {
      ref: z.string(),
      valor: z
        .string()
        .optional()
        .describe('Para lista suspensa: o valor ou o rótulo da opção. Omita para radio/checkbox.'),
      marcado: z.boolean().default(true).describe('Para checkbox: marcar ou desmarcar'),
    },
    ({ ref, valor, marcado }) =>
      portao('interacao', `Escolher em ${ref}`, valor ?? String(marcado), async () => {
        try {
          if (valor !== undefined) await nav.selecionar(ref, valor);
          else await nav.marcar(ref, marcado);
          return comInstantaneo(
            `Escolheu em ${ref}${valor !== undefined ? `: "${valor}"` : marcado ? '' : ' (desmarcou)'}`,
            'escolher',
          );
        } catch (err) {
          return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
  );

  // -------------------------------------------------------------------------
  // Ações sensíveis
  // -------------------------------------------------------------------------

  const entrar = tool(
    'entrar',
    'Faz login com a credencial guardada no cofre para este domínio. Você NÃO vê a senha ' +
      'e não precisa dela: o servidor digita direto no navegador. Se souber os refs dos ' +
      'campos pelo instantâneo, passe-os — fica mais confiável que a busca automática.',
    {
      refUsuario: z.string().optional().describe('ref do campo de usuário/email'),
      refSenha: z.string().optional().describe('ref do campo de senha'),
      refBotao: z.string().optional().describe('ref do botão de entrar'),
    },
    ({ refUsuario, refSenha, refBotao }) => {
      const url = nav.urlAtual() ?? getConfig().alvo.urlBase;
      const cred = cofre.paraUrl(url);
      if (!cred) {
        return Promise.resolve(
          texto(
            `Não há credencial no cofre para ${cofre.hostDe(url)}. ` +
              'Peça ao dono para cadastrar na aba Cofre.',
          ),
        );
      }
      return portao(
        'autenticar',
        `Entrar como "${cred.usuario}" em ${cred.dominio}`,
        `Credencial "${cred.rotulo}" (usuário ${cred.usuario}). A senha vai do cofre direto para o navegador.`,
        async () => {
          const r = await nav.autenticar(cred.id, refUsuario, refSenha, refBotao);
          await appendPasso(
            sessaoId,
            r.ok ? 'agiu' : 'erro',
            r.ok ? `Entrou como "${cred.usuario}"` : `Login falhou: ${r.detalhe}`,
            { ferramenta: 'entrar', url: nav.urlAtual() ?? undefined },
          );
          return texto(`${r.detalhe}\n\n${await nav.instantaneo()}`);
        },
      );
    },
  );

  const submeter = tool(
    'submeter',
    'Envia respostas, finaliza tentativa, confirma entrega — qualquer clique que deixa ' +
      'marca e em geral NÃO dá para desfazer. Descreva em `respostas` exatamente o que ' +
      'está sendo enviado: é isso que o dono lê para aprovar.',
    {
      ref: z.string().describe('ref do botão de envio/confirmação'),
      acao: z
        .enum(['submeter', 'iniciar_tentativa', 'enviar_arquivo', 'marcar_concluido'])
        .describe('A natureza do que este clique faz'),
      respostas: z
        .string()
        .describe('O conteúdo exato em jogo: as respostas escolhidas, o arquivo, a confirmação'),
    },
    ({ ref, acao, respostas }) =>
      portao(acao, `${acao} em ${nav.urlAtual() ?? 'página atual'}`, respostas, async () => {
        try {
          await nav.clicar(ref);
          await appendPasso(sessaoId, 'agiu', `Submeteu (${acao}): ${respostas.slice(0, 200)}`, {
            ferramenta: 'submeter',
            url: nav.urlAtual() ?? undefined,
          });
          return texto(await nav.instantaneo());
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await appendPasso(sessaoId, 'erro', `Submissão falhou: ${msg}`, { ferramenta: 'submeter' });
          return texto(`ERRO: ${msg}`);
        }
      }),
  );

  // -------------------------------------------------------------------------
  // Diálogo com o dono
  // -------------------------------------------------------------------------

  const perguntar = tool(
    'perguntar',
    'Pergunta ao dono quando você está genuinamente travado: captcha, 2FA, questão ' +
      'ambígua, algo que só ele sabe. Bloqueia até ele responder.',
    {
      pergunta: z.string(),
      contexto: z.string().describe('O que você já tentou e por que travou'),
    },
    async ({ pergunta, contexto }) => {
      const d = await pedir(sessaoId, 'submeter', `Pergunta: ${pergunta}`, contexto);
      return texto(
        d.aprovado
          ? `O dono confirmou. Observação: ${d.motivo}. Siga.`
          : `O dono respondeu: ${d.motivo}`,
      );
    },
  );

  const anotar = tool(
    'anotar',
    'Registra um raciocínio ou achado na trilha da sessão, para o dono acompanhar. ' +
      'Não age na página. No modo "observar", é aqui que você diz o que faria.',
    { nota: z.string() },
    async ({ nota }) => {
      await appendPasso(sessaoId, 'pensou', nota, { url: nav.urlAtual() ?? undefined });
      return texto('anotado');
    },
  );

  return createSdkMcpServer({
    name: SERVIDOR_MCP,
    version: '1.0.0',
    tools: [
      abrir, olhar, capturar, rolar, voltar, esperar,
      clicar, escrever, escolher,
      entrar, submeter,
      perguntar, anotar,
    ],
  });
}

/** Os nomes qualificados, para entrar em `allowedTools`. */
export const FERRAMENTAS_LMS = [
  'abrir', 'olhar', 'capturar', 'rolar', 'voltar', 'esperar',
  'clicar', 'escrever', 'escolher',
  'entrar', 'submeter',
  'perguntar', 'anotar',
].map((n) => `mcp__${SERVIDOR_MCP}__${n}`);
