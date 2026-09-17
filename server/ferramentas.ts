import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as nav from './navegador';
import * as cofre from './cofre';
import { avaliar, pedir } from './aprovacao';
import { appendPasso, getConfig, getSessao } from './store';
import type { AcaoSensivel } from '../shared/types';
import * as tentativas from './tentativas';
import * as trabalhos from './trabalhos';
import { gerarPdf } from './pdf';
import { compactar } from './compactar';
import * as achados from './achados';
import * as brave from './brave';
import * as maquina from './maquina';
import * as mudancas from './mudancas';
import { classificar } from './comandos';
import { sanear, perguntar as perguntarAoDono } from './perguntas';
import { log, aviso, erro as logErro, cronometro } from './log';

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
/**
 * Resume os argumentos para o log sem despejar um enunciado inteiro nele.
 * Nenhuma ferramenta recebe senha (o cofre resolve isso por dentro), então não
 * há segredo a filtrar aqui — mas se um dia houver, é neste ponto que ele seria
 * cortado.
 */
function resumirArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && v.length > 160 ? `${v.slice(0, 160)}…` : v;
  }
  return out;
}

/**
 * Envolve `tool()` para que TODA ferramenta registre entrada, saída, duração e
 * erro — sem precisar lembrar de instrumentar cada handler. É o que me deixa
 * ler o turno em tempo real e ver onde ele travou: uma ferramenta que demora
 * 20 s ou devolve instantâneo de 0 caractere aparece sozinha no log.
 */
function comLog(
  nome: string,
  handler: (args: never) => Promise<Conteudo>,
): (args: never) => Promise<Conteudo> {
  return async (args: never) => {
    const medir = cronometro();
    log('ferramenta', `→ ${nome}`, resumirArgs(args));
    try {
      const r = await handler(args);
      const blocos = (r?.content ?? []) as Array<{ type: string; text?: string }>;
      const saida = blocos.map((c) => c.text ?? `[${c.type}]`).join(' ');
      log('ferramenta', `← ${nome}`, {
        ms: medir(),
        chars: saida.length,
        inicio: saida.slice(0, 200).replace(/\n/g, ' ⏎ '),
      });
      return r;
    } catch (err) {
      logErro('ferramenta', `✗ ${nome} lançou`, err, { ms: medir() });
      throw err;
    }
  };
}

/**
 * Mesma assinatura de `tool()`, só que com o log embutido. O cast existe porque
 * `tool` é genérica no schema e só queremos interceptar o handler.
 */
const ferramenta = ((nome: string, descricao: string, schema: unknown, handler: unknown) =>
  (tool as unknown as (...a: unknown[]) => unknown)(
    nome,
    descricao,
    schema,
    comLog(nome, handler as (args: never) => Promise<Conteudo>),
  )) as unknown as typeof tool;

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
    // A trava de entrega vem primeiro e não negocia: com ela desligada, nada
    // sai desta máquina para o LMS. Perguntar ao dono seria perder o ponto —
    // ele já respondeu quando deixou a trava fechada.
    const ENTREGA: AcaoSensivel[] = ['submeter', 'enviar_arquivo', 'marcar_concluido'];
    // A trava é do módulo LMS. Numa missão web, o que segura compra, mensagem
    // ou publicação é o portão de aprovação do modo — logo abaixo.
    const ehLms = getSessao(sessaoId)?.missao !== 'web';
    if (ehLms && ENTREGA.includes(acao as AcaoSensivel) && !getConfig().permitirEntrega) {
      const motivo =
        'a trava de entrega está fechada (permitirEntrega=false): produzir arquivo pode, ' +
        'enviar para o LMS não. Termine os arquivos em trabalhos/ e relate — o dono revisa ' +
        'e entrega na mão.';
      aviso('portao', 'entrega bloqueada pela trava', { acao, url: nav.urlAtual() });
      await appendPasso(sessaoId, 'recusado', `${descricao} — ${motivo}`);
      return texto(`AÇÃO NÃO EXECUTADA. ${motivo}`);
    }

    const veredito = avaliar(acao);
    log('portao', 'avaliou', { acao, veredito: veredito.tipo, descricao: descricao.slice(0, 120) });

    if (veredito.tipo === 'recusado') {
      await appendPasso(sessaoId, 'recusado', `${descricao} — ${veredito.motivo}`);
      return texto(`AÇÃO NÃO EXECUTADA. ${veredito.motivo}`);
    }

    if (veredito.tipo === 'precisa-aprovacao') {
      const decisao = await pedir(sessaoId, acao as AcaoSensivel, descricao, detalhe);
      log('portao', 'dono decidiu', { acao, aprovado: decisao.aprovado, motivo: decisao.motivo });
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

  const abrir = ferramenta(
    'abrir',
    'Abre o navegador e vai até uma URL. Aceita URL completa ou, numa missão LMS, caminho ' +
      'relativo (/curso/123). Só navega dentro da política de domínio da sessão — fora dela ' +
      'recusa e explica o motivo. Devolve o instantâneo da página.',
    { url: z.string().describe('URL completa (https) ou caminho relativo ao alvo LMS') },
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

  const olhar = ferramenta(
    'olhar',
    'Tira um instantâneo do que está na tela agora: a árvore de elementos com os refs ' +
      '(ref=e12) que você usa para agir. Use depois de qualquer mudança que você não causou. ' +
      'Em página longa (listagem de loja, resultado de busca) passe `filtro` — ex. "R$" para ver só ' +
      'as linhas com preço, ou o nome do produto — em vez de ler tudo; e `maxLinhas` se o ' +
      'instantâneo vier cortado.',
    {
      filtro: z.string().optional().describe('Só linhas que contêm este texto (sem diferenciar maiúsculas)'),
      maxLinhas: z.number().min(50).max(1500).optional().describe('Teto de linhas; padrão 400'),
    },
    async ({ filtro, maxLinhas }) => {
      try {
        let snap = await nav.instantaneo(maxLinhas ?? 400);
        if (filtro?.trim()) {
          // Cabeçalho (URL/título) e rodapé (contagem/corte) ficam; o meio é peneirado.
          const linhas = snap.split('\n');
          const alvo = filtro.trim().toLowerCase();
          const cabecalho = linhas.slice(0, 2);
          const rodape = linhas.filter((l) => l.startsWith('['));
          const meio = linhas.slice(2).filter((l) => !l.startsWith('[') && l.toLowerCase().includes(alvo));
          snap = [...cabecalho, '', `(filtro "${filtro.trim()}": ${meio.length} linha(s))`, ...meio, '', ...rodape].join('\n');
        }
        await appendPasso(sessaoId, 'leu', filtro ? `Leu a página filtrando por "${filtro}"` : 'Leu a página', {
          ferramenta: 'olhar',
          url: nav.urlAtual() ?? undefined,
        });
        return texto(snap);
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const capturar = ferramenta(
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

  const rolar = ferramenta(
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

  const voltar = ferramenta(
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

  const esperar = ferramenta(
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

  const clicar = ferramenta(
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

  const escreverCampo = ferramenta(
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

  const escolher = ferramenta(
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

  const entrar = ferramenta(
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

  const submeter = ferramenta(
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
    ({ ref, acao, respostas }) => {
      // A trava de tentativas vem ANTES do portão de aprovação de propósito: se
      // a resposta é "não pode", não faz sentido acordar o dono para perguntar.
      if (acao === 'iniciar_tentativa') {
        const v = tentativas.podeIniciar(nav.urlAtual() ?? '');
        if (!v.permitido) {
          aviso('ferramentas', 'iniciar_tentativa barrado pelo limite', {
            url: nav.urlAtual(), jaFeitas: v.jaFeitas, limite: v.limite,
          });
          void appendPasso(sessaoId, 'recusado', `Tentativa barrada: ${v.motivo}`, {
            ferramenta: 'submeter',
            url: nav.urlAtual() ?? undefined,
          });
          return Promise.resolve(texto(`AÇÃO NÃO EXECUTADA — ${v.motivo}`));
        }
        log('ferramentas', 'iniciar_tentativa liberado', { motivo: v.motivo });
      }

      return portao(acao, `${acao} em ${nav.urlAtual() ?? 'página atual'}`, respostas, async () => {
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
      });
    },
  );

  // -------------------------------------------------------------------------
  // Produção dos entregáveis
  // -------------------------------------------------------------------------

  const escrever = ferramenta(
    'escrever_arquivo',
    'Cria ou substitui um arquivo do trabalho. O caminho é relativo à pasta trabalhos/ ' +
      'e você NÃO alcança nada fora dela. Use uma subpasta por atividade ' +
      '(ex.: "juncoes-tabelas/consultas.sql"). Escreva o arquivo inteiro: isto substitui, ' +
      'não acrescenta.',
    {
      caminho: z.string().describe('Relativo a trabalhos/, ex.: fintech-bd/README.md'),
      conteudo: z.string().describe('O conteúdo completo do arquivo'),
      porque: z.string().describe('O que este arquivo entrega da atividade'),
    },
    async ({ caminho, conteudo, porque }) => {
      try {
        const { bytes } = await trabalhos.escrever(caminho, conteudo);
        await appendPasso(sessaoId, 'agiu', `Escreveu ${caminho} (${bytes} bytes) — ${porque}`, {
          ferramenta: 'escrever_arquivo',
        });
        return texto(`gravado: trabalhos/${caminho} (${bytes} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await appendPasso(sessaoId, 'erro', `Falha ao escrever ${caminho}: ${msg}`, {
          ferramenta: 'escrever_arquivo',
        });
        return texto(`ERRO: ${msg}`);
      }
    },
  );

  const lerArquivo = ferramenta(
    'ler_arquivo',
    'Lê um arquivo que você já criou em trabalhos/. Use antes de reescrever, para não ' +
      'perder o que já estava lá.',
    { caminho: z.string() },
    async ({ caminho }) => {
      try {
        return texto(await trabalhos.ler(caminho));
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const listarArquivos = ferramenta(
    'listar_arquivos',
    'Lista o que já existe em trabalhos/, com tamanho. Use para saber onde você parou.',
    { subpasta: z.string().optional().describe('Limita a uma subpasta') },
    async ({ subpasta }) => {
      try {
        const itens = await trabalhos.listar(subpasta);
        if (!itens.length) return texto('(nada em trabalhos/ ainda)');
        return texto(itens.map((i) => `${String(i.bytes).padStart(8)}  ${i.caminho}`).join('\n'));
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const apagarArquivo = ferramenta(
    'apagar_arquivo',
    'Apaga um arquivo de trabalhos/. Use para tirar da pasta de entrega algo que não deveria ' +
      'ir ao professor — depois de mover o conteúdo para `nota_para_dono`.',
    { caminho: z.string(), porque: z.string().describe('Por que este arquivo não fica') },
    async ({ caminho, porque }) => {
      try {
        const ok = await trabalhos.apagar(caminho);
        if (!ok) return texto(`não existia: ${caminho}`);
        await appendPasso(sessaoId, 'agiu', `Apagou ${caminho} — ${porque}`, {
          ferramenta: 'apagar_arquivo',
        });
        return texto(`apagado: trabalhos/${caminho}`);
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const baixarAnexo = ferramenta(
    'baixar_anexo',
    'Baixa um arquivo do LMS (enunciado em PDF, dataset, template) para dentro de ' +
      'trabalhos/. Passe o ref do link OU a URL. Use quando a atividade tiver material ' +
      'anexado que você precisa ler para entregar certo.',
    {
      ref: z.string().optional().describe('ref do link no instantâneo'),
      url: z.string().optional().describe('ou a URL direta'),
      destino: z.string().describe('Onde salvar, ex.: juncoes-tabelas/enunciado.pdf'),
    },
    async ({ ref, url, destino }) => {
      try {
        let alvo = url;
        if (!alvo && ref) alvo = (await nav.hrefDe(ref)) ?? undefined;
        if (!alvo) return texto('ERRO: informe `ref` de um link com href, ou `url`.');

        const { dados, tipo, nome } = await nav.baixar(alvo);
        const { bytes } = await trabalhos.gravarBinario(destino, dados);
        await appendPasso(sessaoId, 'agiu', `Baixou "${nome}" para ${destino} (${bytes} bytes)`, {
          ferramenta: 'baixar_anexo',
        });
        return texto(
          `baixado: trabalhos/${destino} (${bytes} bytes, ${tipo}).\n` +
            (tipo.includes('text') || tipo.includes('json')
              ? 'É texto — use `ler_arquivo` para ver o conteúdo.'
              : 'É binário: você não consegue ler o conteúdo daqui. Se for o enunciado, ' +
                'procure a versão em HTML na própria página do LMS.'),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await appendPasso(sessaoId, 'erro', `Falha ao baixar para ${destino}: ${msg}`, {
          ferramenta: 'baixar_anexo',
        });
        return texto(`ERRO: ${msg}`);
      }
    },
  );

  const gerarPdfTool = ferramenta(
    'gerar_pdf',
    'Converte um arquivo HTML de trabalhos/ em PDF. Use quando a atividade EXIGIR PDF — ' +
      'escreva primeiro um .html completo (com <style> embutido; diagrama como SVG inline, ' +
      'que imprime nítido) e converta. Nada de link para CSS ou imagem externa: só o que ' +
      'estiver dentro do arquivo ou na mesma pasta entra no PDF.',
    {
      html: z.string().describe('O .html de origem, ex.: juncoes-tabelas/entrega.html'),
      pdf: z.string().describe('O .pdf de destino, ex.: juncoes-tabelas/entrega.pdf'),
      paisagem: z.boolean().default(false).describe('Use para diagrama largo'),
    },
    async ({ html, pdf, paisagem }) => {
      try {
        const { bytes } = await gerarPdf(html, pdf, { paisagem });
        await appendPasso(sessaoId, 'agiu', `Gerou ${pdf} (${bytes} bytes) a partir de ${html}`, {
          ferramenta: 'gerar_pdf',
        });
        return texto(`gerado: trabalhos/${pdf} (${bytes} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await appendPasso(sessaoId, 'erro', `Falha ao gerar ${pdf}: ${msg}`, {
          ferramenta: 'gerar_pdf',
        });
        return texto(`ERRO: ${msg}`);
      }
    },
  );

  const notaTool = ferramenta(
    'nota_para_dono',
    'ÚNICO lugar para recado ao dono: o que ficou faltando, o que ele precisa conferir, o que ' +
      'depende do grupo. Vai para _notas/, FORA da pasta de entrega, e nunca entra no ZIP. ' +
      'Nada disso pode aparecer dentro de um arquivo do trabalho — o professor leria junto.',
    {
      atividade: z.string().describe('A qual atividade o recado se refere, ex.: juncoes-tabelas'),
      texto: z.string().describe('O recado completo, em Markdown'),
    },
    async ({ atividade, texto: conteudo }) => {
      try {
        const rel = await trabalhos.notaParaDono(atividade, conteudo);
        await appendPasso(sessaoId, 'agiu', `Deixou recado para o dono em ${rel}`, {
          ferramenta: 'nota_para_dono',
        });
        return texto(`recado gravado em trabalhos/${rel} (fora da entrega)`);
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const revisarTool = ferramenta(
    'revisar_entregaveis',
    'Varre os arquivos de entrega procurando recado ao dono que tenha vazado para dentro ' +
      'deles (PREENCHER, TODO, "confirme com", "depende de você", "AVISO IMPORTANTE"). ' +
      'Rode SEMPRE antes de encerrar: se apontar algo, reescreva o arquivo sem aquilo e mova ' +
      'o conteúdo para `nota_para_dono`.',
    {},
    async () => {
      const suspeitas = await trabalhos.revisarEntregaveis();
      if (!suspeitas.length) return texto('limpo: nenhum recado ao dono dentro dos entregáveis.');
      return texto(
        `${suspeitas.length} trecho(s) que parecem recado ao dono DENTRO da entrega — ` +
          'tire-os do arquivo e mova para `nota_para_dono`:\n\n' +
          suspeitas.map((s) => `${s.caminho}:${s.linha}  ${s.trecho}`).join('\n'),
      );
    },
  );

  const compactarTool = ferramenta(
    'compactar',
    'Compacta uma subpasta de trabalhos/ num .zip. Use quando o enunciado pedir o projeto ' +
      'em ZIP. Se o nome exigido depender de um dado que você não tem (número do grupo, por ' +
      'exemplo), NÃO chute: deixe o ZIP com nome provisório e diga isso no LEIA.md.',
    {
      pasta: z.string().describe('A subpasta a compactar, ex.: fintech-jdbc'),
      zip: z.string().describe('O destino, ex.: fintech-jdbc.zip'),
    },
    async ({ pasta, zip }) => {
      try {
        const { bytes } = await compactar(pasta, zip);
        await appendPasso(sessaoId, 'agiu', `Compactou ${pasta} em ${zip} (${bytes} bytes)`, {
          ferramenta: 'compactar',
        });
        return texto(`gerado: trabalhos/${zip} (${bytes} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await appendPasso(sessaoId, 'erro', `Falha ao compactar ${pasta}: ${msg}`, {
          ferramenta: 'compactar',
        });
        return texto(`ERRO: ${msg}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Pesquisa: achados e perfil
  // -------------------------------------------------------------------------

  const registrarAchado = ferramenta(
    'registrar_achado',
    'Registra algo que você encontrou, com a URL de onde veio. É o que o dono confere depois, ' +
      'item a item, na página Achados. Produto: em `dados`, um par {chave:"preco", valor:2899.9} ' +
      'com o preço como NÚMERO, mais vendedor, condicao, frete, site, link. Sem fonte não é achado.',
    {
      tipo: z.enum(['produto', 'fato', 'documento', 'pessoa', 'contato', 'outro']),
      titulo: z.string().describe('Curto e específico, ex.: "Galaxy Tab S8 128GB Wi-Fi — Mercado Livre"'),
      resumo: z.string().describe('O que é e por que importa, em 1-3 frases'),
      // Lista de pares, não `z.record`: a conversão zod→JSON Schema do SDK
      // quebra em tools/list com record em QUALQUER forma, e um schema quebrado
      // derruba o servidor MCP inteiro — o agente fica sem navegador e cai no
      // toolset padrão do Claude Code. Bisseção em testes/ferramentas.ts.
      dados: z
        .array(
          z.object({
            chave: z.string().describe('ex.: preco, vendedor, condicao, frete, link'),
            valor: z.union([z.string(), z.number(), z.boolean()]),
          }),
        )
        .optional()
        .describe('Campos estruturados como pares. preco como NÚMERO (ex. 2899.9).'),
      fonte: z.string().describe('URL exata da página onde você viu isto'),
      confianca: z.enum(['alta', 'media', 'baixa']).default('media'),
    },
    async ({ tipo, titulo, resumo, dados, fonte, confianca }) => {
      try {
        new URL(fonte);
      } catch {
        return texto(`ERRO: "fonte" precisa ser uma URL válida (recebi "${fonte}"). Sem fonte não é achado.`);
      }
      const mapa: Record<string, string | number | boolean> = {};
      for (const { chave, valor } of dados ?? []) mapa[chave.trim()] = valor;
      const a = await achados.registrar({ sessaoId, tipo, titulo, resumo, dados: mapa, fonte, confianca });
      await appendPasso(sessaoId, 'agiu', `Registrou achado (${tipo}): ${a.titulo}`, {
        ferramenta: 'registrar_achado',
        url: fonte,
      });
      return texto(`achado ${a.id} registrado.`);
    },
  );

  const dadosPessoais = ferramenta(
    'dados_pessoais',
    'Devolve os dados pessoais que o dono preencheu no perfil (nome, CEP, endereço, cidade...), ' +
      'para você digitar num site que pede região ou identificação. Cada leitura fica na trilha. ' +
      'Use só o campo que a tarefa pede.',
    { porque: z.string().describe('Para que você precisa disso agora') },
    async ({ porque }) => {
      const perfil = getConfig().perfil;
      const preenchidos = Object.entries(perfil).filter(([, v]) => typeof v === 'string' && v.trim());
      if (!preenchidos.length) {
        return texto('O dono não preencheu dados pessoais na Configuração. Use `perguntar` se um site exigir.');
      }
      await appendPasso(sessaoId, 'leu', `Leu seus dados pessoais — ${porque}`, {
        ferramenta: 'dados_pessoais',
        url: nav.urlAtual() ?? undefined,
      });
      aviso('perfil', 'dados pessoais lidos pelo agente', {
        porque: porque.slice(0, 120),
        campos: preenchidos.map(([k]) => k),
      });
      return texto(preenchidos.map(([k, v]) => `${k}: ${v}`).join('\n'));
    },
  );

  const buscarWeb = ferramenta(
    'buscar_web',
    'Busca na web pela API do Brave e devolve título, URL e descrição dos resultados — sem abrir ' +
      'buscador no navegador, sem captcha. Use para descobrir ONDE procurar; depois `abrir` a página ' +
      'certa e leia de verdade. Resultado de busca não é achado: registre só o que confirmar na página.',
    {
      consulta: z.string().describe('Termos da busca, como você digitaria no buscador'),
      quantidade: z.number().min(1).max(20).default(10),
    },
    async ({ consulta, quantidade }) => {
      try {
        const itens = await brave.buscar(consulta, quantidade);
        await appendPasso(sessaoId, 'leu', `Buscou na web: "${consulta}" (${itens.length} resultados)`, {
          ferramenta: 'buscar_web',
        });
        if (!itens.length) return texto(`Nenhum resultado para "${consulta}".`);
        return texto(itens.map((r, i) => `${i + 1}. ${r.titulo}\n   ${r.url}\n   ${r.descricao}`).join('\n\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return texto(
          `ERRO: ${msg}${msg.includes('não configurado') ? ' Enquanto isso, abra duckduckgo.com pelo navegador.' : ''}`,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // A máquina do dono
  // -------------------------------------------------------------------------

  /**
   * A trava-mestre. Sem ela, nenhuma ferramenta de desktop faz nada — nem as
   * de leitura. Controlar o PC do dono é coisa que se liga de propósito.
   */
  function maquinaLiberada(): string | null {
    if (getConfig().permitirMaquina) return null;
    return (
      'as ferramentas de máquina estão DESLIGADAS (permitirMaquina=false). ' +
      'Isso é configuração do dono, não erro — peça a ele para ligar em Configuração → Máquina ' +
      'se a tarefa realmente precisar mexer no computador.'
    );
  }

  const verJanelas = ferramenta(
    'ver_janelas',
    'Lista as janelas abertas no Windows: nome, tipo e o pid, que é por onde você pede a árvore ' +
      'de uma delas. Comece por aqui quando a tarefa envolver um programa do computador.',
    {},
    async () => {
      const travada = maquinaLiberada();
      if (travada) return texto(`AÇÃO NÃO EXECUTADA. ${travada}`);
      try {
        const js = await maquina.janelas();
        await appendPasso(sessaoId, 'leu', `Listou ${js.length} janela(s) abertas`, { ferramenta: 'ver_janelas' });
        if (!js.length) return texto('Nenhuma janela visível.');
        return texto(
          js.map((j) => `pid=${j.pid} [${j.tipo}] "${j.nome}" — ${j.largura}x${j.altura} em (${j.x},${j.y})`).join('\n'),
        );
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const verJanela = ferramenta(
    'ver_janela',
    'Lê a árvore de acessibilidade de UMA janela (pelo pid de `ver_janelas`) — o mesmo modelo do ' +
      'navegador: cada elemento com um `ref=pid:caminho` que as ações usam. Refs mudam quando a ' +
      'janela muda: leia de novo depois de agir.',
    {
      pid: z.number().describe('O pid da janela, vindo de `ver_janelas`'),
      maxLinhas: z.number().min(20).max(800).default(250),
    },
    async ({ pid, maxLinhas }) => {
      const travada = maquinaLiberada();
      if (travada) return texto(`AÇÃO NÃO EXECUTADA. ${travada}`);
      try {
        const arv = await maquina.arvore(pid, maxLinhas);
        await appendPasso(sessaoId, 'leu', `Leu a janela pid=${pid}`, { ferramenta: 'ver_janela' });
        return texto(arv);
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const verTela = ferramenta(
    'ver_tela',
    'Foto da tela inteira. Use quando a árvore não bastar — jogo, player de vídeo, programa que ' +
      'desenha a própria interface (Wallpaper Engine, editores). Custa muito mais que `ver_janela`.',
    { motivo: z.string().describe('Por que a árvore não bastou aqui') },
    async ({ motivo }) => {
      const travada = maquinaLiberada();
      if (travada) return texto(`AÇÃO NÃO EXECUTADA. ${travada}`);
      try {
        const c = await maquina.captura();
        await appendPasso(sessaoId, 'leu', `Capturou a tela: ${motivo}`, { ferramenta: 'ver_tela' });
        return {
          content: [
            { type: 'image' as const, data: c.base64, mimeType: 'image/jpeg' },
            { type: 'text' as const, text: `Tela ${c.largura}x${c.altura}.` },
          ],
        } as unknown as Conteudo;
      } catch (err) {
        return texto(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  const usarJanela = ferramenta(
    'usar_janela',
    'Age num elemento de uma janela pelo ref de `ver_janela`: clicar num botão, marcar uma caixa, ' +
      'escrever num campo, focar a janela. Usa os padrões de acessibilidade do Windows — não move ' +
      'o mouse do dono, salvo quando o elemento não oferece outro jeito.',
    {
      acao: z.enum(['clicar', 'alternar', 'escrever', 'focar']),
      ref: z.string().optional().describe('ref do elemento (ex.: 13340:1.0.2). Para "focar", use pid.'),
      pid: z.number().optional().describe('Só para "focar": a janela a trazer para a frente'),
      texto: z.string().optional().describe('Só para "escrever": o conteúdo do campo'),
      porque: z.string().describe('O que você espera que aconteça'),
    },
    ({ acao, ref, pid, texto: conteudo, porque }) => {
      const travada = maquinaLiberada();
      if (travada) return Promise.resolve(texto(`AÇÃO NÃO EXECUTADA. ${travada}`));

      // Mexer na janela de um programa é interação, como clicar numa página: o
      // que exige aprovação é MUDAR O SISTEMA, que tem ferramenta própria.
      return portao('interacao', `${acao} em ${ref ?? `pid ${pid}`}: ${porque}`, conteudo ?? '', async () => {
        try {
          let r: string;
          if (acao === 'focar') {
            if (!pid) return texto('ERRO: "focar" precisa do pid.');
            r = await maquina.focar(pid);
          } else if (acao === 'escrever') {
            if (!ref || conteudo === undefined) return texto('ERRO: "escrever" precisa de ref e texto.');
            r = await maquina.escrever(ref, conteudo);
          } else if (acao === 'alternar') {
            if (!ref) return texto('ERRO: "alternar" precisa de ref.');
            r = await maquina.alternar(ref);
          } else {
            if (!ref) return texto('ERRO: "clicar" precisa de ref.');
            r = await maquina.clicar(ref);
          }
          await appendPasso(sessaoId, 'agiu', `${r} — ${porque}`, { ferramenta: 'usar_janela' });
          return texto(`${r}\n\nLeia a janela de novo com ver_janela: os refs mudaram.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await appendPasso(sessaoId, 'erro', `Falha ao ${acao}: ${msg}`, { ferramenta: 'usar_janela' });
          return texto(`ERRO: ${msg}`);
        }
      });
    },
  );

  const inspecionarSistema = ferramenta(
    'inspecionar_sistema',
    'Roda um comando PowerShell de LEITURA e devolve a saída: Get-*, Test-*, Measure-*, e os ' +
      'cmdlets que só formatam (Select/Where/Sort/Format). Serve para descobrir o estado do PC — ' +
      'energia, serviços, processos, registro, hardware. Qualquer coisa que MUDE algo é recusada ' +
      'aqui: para isso existe `mudar_sistema`.',
    { comando: z.string(), porque: z.string().describe('O que você quer descobrir') },
    async ({ comando, porque }) => {
      const travada = maquinaLiberada();
      if (travada) return texto(`AÇÃO NÃO EXECUTADA. ${travada}`);

      // A classificação é código, não confiança: ver server/comandos.ts.
      const v = classificar(comando);
      if (!v.leitura) {
        aviso('maquina', 'comando de leitura recusado', { comando: comando.slice(0, 160), motivo: v.motivo });
        await appendPasso(sessaoId, 'recusado', `Comando recusado como leitura: ${v.motivo}`, {
          ferramenta: 'inspecionar_sistema',
        });
        return texto(
          `AÇÃO NÃO EXECUTADA — isto não é leitura: ${v.motivo}. ` +
            'Se a intenção é mesmo mudar o sistema, use `mudar_sistema`, que passa pela aprovação do dono.',
        );
      }

      const r = await maquina.executar(comando, 60000);
      await appendPasso(sessaoId, 'leu', `Inspecionou o sistema: ${porque}`, { ferramenta: 'inspecionar_sistema' });
      return texto(r.saida);
    },
  );

  const mudarSistema = ferramenta(
    'mudar_sistema',
    'Roda um comando PowerShell que MUDA a máquina do dono (energia, registro, serviço, tarefa ' +
      'agendada, configuração de programa). SEMPRE passa pela aprovação dele. Você é obrigado a ' +
      'dizer o que muda e como desfazer — e o "como desfazer" vai para um diário que o dono lê ' +
      'depois, quando não lembrar mais o que foi mexido. Comando que você não sabe desfazer é ' +
      'comando que você não deveria rodar.',
    {
      comando: z.string().describe('O comando PowerShell, completo'),
      oQueMuda: z.string().describe('Em uma frase, o que muda no PC depois disso'),
      comoDesfazer: z.string().describe('O comando ou o caminho exato para voltar ao estado anterior'),
    },
    ({ comando, oQueMuda, comoDesfazer }) => {
      const travada = maquinaLiberada();
      if (travada) return Promise.resolve(texto(`AÇÃO NÃO EXECUTADA. ${travada}`));

      const detalhe = [
        `O QUE MUDA: ${oQueMuda}`,
        '',
        'COMANDO:',
        comando,
        '',
        `COMO DESFAZER: ${comoDesfazer}`,
      ].join('\n');

      return portao('submeter', `Mudar o sistema: ${oQueMuda}`, detalhe, async () => {
        const r = await maquina.executar(comando, 120000);
        await mudancas.registrar({ sessaoId, oQueMuda, comando, comoDesfazer, saida: r.saida, ok: r.ok });
        await appendPasso(
          sessaoId,
          r.ok ? 'agiu' : 'erro',
          `${r.ok ? 'Mudou o sistema' : 'Falhou ao mudar o sistema'}: ${oQueMuda}`,
          { ferramenta: 'mudar_sistema' },
        );
        return texto(
          `${r.ok ? 'Aplicado' : 'FALHOU'}. Saída:\n${r.saida}\n\n` +
            'Registrado no diário de mudanças, com o modo de desfazer. Confira se o efeito é o esperado.',
        );
      });
    },
  );

  // -------------------------------------------------------------------------
  // Diálogo com o dono
  // -------------------------------------------------------------------------

  const perguntar = ferramenta(
    'perguntar',
    'PERGUNTE ao dono quando a decisão for DELE — um caminho que muda o rumo do trabalho, um ' +
      'trade-off que só ele sabe pesar, captcha ou 2FA, algo que você não tem como deduzir. ' +
      'Vira um FORMULÁRIO na tela (bolinhas, caixinhas, campo de texto), não um parágrafo. ' +
      'Mande TODAS as perguntas numa chamada só: ele vê o formulário inteiro e decide de uma vez. ' +
      'A ferramenta fica parada até ele responder. NÃO use para confirmar o óbvio nem para narrar.',
    {
      questions: z
        .array(
          z.object({
            question: z.string().describe('A pergunta, escrita para uma pessoa — clara e específica.'),
            header: z.string().optional().describe('Etiqueta curta que vira um chip (ex.: "Energia", "Escopo"). Até 24 caracteres.'),
            multiSelect: z.boolean().optional().describe('true = ele pode marcar VÁRIAS opções. Vale por pergunta.'),
            options: z
              .array(
                z.object({
                  label: z.string().describe('O texto do botão — curto; é a identidade da escolha.'),
                  description: z.string().optional().describe('O que essa opção IMPLICA — a consequência, não o rótulo repetido.'),
                }),
              )
              .optional()
              .describe('2 a 4 opções (até 6 aceitas). OMITA para pergunta ABERTA, com campo de texto.'),
          }),
        )
        .describe('1 a 4 perguntas. Acima disso o excedente é cortado — agrupe por tema.'),
      contexto: z.string().describe('O que você já tentou e por que está travado'),
    },
    async (input) => {
      const itens = sanear(input as { questions?: unknown });
      // Nada aproveitável: não inventa formulário meio pronto — cai no caminho
      // que sempre existiu, o pedido de aprovação em texto.
      if (!itens.length) {
        const d = await pedir(sessaoId, 'submeter', 'Pergunta ao dono', (input as { contexto?: string }).contexto ?? '');
        return texto(d.aprovado ? `O dono confirmou: ${d.motivo}` : `O dono respondeu: ${d.motivo}`);
      }
      const r = await perguntarAoDono(sessaoId, itens, (input as { contexto?: string }).contexto ?? '');
      return texto(
        r.respondida
          ? `O dono respondeu:\n\n${r.resposta}\n\nSiga o trabalho com isso.`
          : `AÇÃO NÃO EXECUTADA — ${r.resposta}. Não chute a decisão: encerre dizendo o que ficou pendente.`,
      );
    },
  );

  const anotar = ferramenta(
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
      clicar, escreverCampo, escolher,
      entrar, submeter,
      escrever, lerArquivo, listarArquivos, apagarArquivo, baixarAnexo, gerarPdfTool, compactarTool, notaTool, revisarTool, registrarAchado, dadosPessoais, buscarWeb,
      verJanelas, verJanela, verTela, usarJanela, inspecionarSistema, mudarSistema,
      perguntar, anotar,
    ],
  });
}

/** Os nomes qualificados, para entrar em `allowedTools`. */
export const FERRAMENTAS_LMS = [
  'abrir', 'olhar', 'capturar', 'rolar', 'voltar', 'esperar',
  'clicar', 'escrever', 'escolher',
  'entrar', 'submeter',
  'escrever_arquivo', 'ler_arquivo', 'listar_arquivos', 'apagar_arquivo', 'baixar_anexo', 'gerar_pdf', 'compactar', 'nota_para_dono', 'revisar_entregaveis', 'registrar_achado', 'dados_pessoais', 'buscar_web',
  'ver_janelas', 'ver_janela', 'ver_tela', 'usar_janela', 'inspecionar_sistema', 'mudar_sistema',
  'perguntar', 'anotar',
].map((n) => `mcp__${SERVIDOR_MCP}__${n}`);
