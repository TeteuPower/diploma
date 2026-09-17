import { getSessao, patchSessao, appendPasso, agora, genId } from './store';
import { getConfig } from './store';
import { log } from './log';
import type { PerguntaAgente, ItemPergunta } from '../shared/types';

/**
 * Pergunta estruturada — o formulário, não o parágrafo.
 *
 * Inspirado no `perguntasagente.ts` do HIVE, e pelo mesmo motivo que o levou
 * até lá: quando o agente pergunta em TEXTO, a interface tenta adivinhar o
 * formato por regex e erra por natureza — três perguntas viram "escolha uma",
 * uma lista para marcar vira escolha única. Com schema, o que chega na tela é
 * o que ele quis dizer.
 *
 * O que MUDA em relação ao HIVE: lá o turno termina perguntando, porque a
 * pessoa pode voltar amanhã e a sessão é cara de segurar. Aqui a sessão é
 * local, de um dono só, e o portão de aprovação JÁ bloqueia a ferramenta
 * esperando resposta — então a pergunta usa o mesmo caminho: a ferramenta fica
 * pendurada até o dono responder na tela. Um mecanismo de espera, não dois.
 *
 * QUEM SANEIA É AQUI, nunca a tela: o input vem do modelo.
 */

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export interface PerguntasCruas {
  questions?: unknown;
}

/**
 * Sanea o que o modelo mandou. Devolve o que dá para mostrar, ou lista vazia —
 * nunca "meio aceito": formulário pela metade na tela é pior que nenhum.
 *
 * Os limites são os da NOSSA tela, com folga: até 4 perguntas (o excedente é
 * cortado, não recusado — modelo às vezes manda 5), até 6 opções, opção sem
 * rótulo descartada. `options` vazio é legítimo: vira pergunta aberta.
 */
export function sanear(cru: PerguntasCruas): ItemPergunta[] {
  const lista = Array.isArray(cru?.questions) ? cru.questions : [];
  const itens: ItemPergunta[] = [];

  for (const q of lista.slice(0, 4)) {
    const o = (q ?? {}) as Record<string, unknown>;
    const pergunta = texto(o.question, 400);
    if (!pergunta) continue;

    const cruas = Array.isArray(o.options) ? o.options.slice(0, 6) : [];
    const opcoes: ItemPergunta['opcoes'] = [];
    for (const c of cruas) {
      const oc = (c ?? {}) as Record<string, unknown>;
      const rotulo = texto(oc.label, 120);
      // Rótulo repetido some: ele É a identidade da escolha.
      if (!rotulo || opcoes.some((x) => x.rotulo === rotulo)) continue;
      const descricao = texto(oc.description, 300);
      opcoes.push({ rotulo, ...(descricao ? { descricao } : {}) });
    }

    itens.push({
      pergunta,
      ...(texto(o.header, 24) ? { etiqueta: texto(o.header, 24) } : {}),
      // Uma opção só não é escolha: vira pergunta aberta.
      opcoes: opcoes.length >= 2 ? opcoes : [],
      ...(o.multiSelect === true && opcoes.length >= 2 ? { varias: true as const } : {}),
    });
  }
  return itens;
}

/** Quem está esperando: id do pedido → resolve da Promise da ferramenta. */
const pendentes = new Map<string, (resposta: string) => void>();

/**
 * Registra o formulário na sessão e SEGURA a ferramenta até o dono responder.
 * Mesmo mecanismo do portão de aprovação — inclusive o prazo, que sai da mesma
 * configuração: silêncio não vira resposta inventada, vira "ninguém respondeu".
 */
export async function perguntar(
  sessaoId: string,
  itens: ItemPergunta[],
  contexto: string,
): Promise<{ respondida: boolean; resposta: string }> {
  const sessao = getSessao(sessaoId);
  if (!sessao) return { respondida: false, resposta: 'sessão não existe mais' };

  const pergunta: PerguntaAgente = {
    id: genId('perg'),
    at: agora(),
    itens,
    contexto: contexto.slice(0, 2000),
  };

  await patchSessao(sessaoId, { status: 'aguardando', pergunta });
  await appendPasso(
    sessaoId,
    'aprovacao',
    `Perguntou ${itens.length === 1 ? 'uma coisa' : `${itens.length} coisas`}: ${itens[0]?.pergunta.slice(0, 120)}`,
  );
  log('perguntas', 'formulário na tela', { sessao: sessaoId, itens: itens.length });

  const segundos = getConfig().navegador.timeoutAprovacaoS;

  return new Promise((resolve) => {
    let fechado = false;
    const terminar = (resposta: string, respondida: boolean) => {
      if (fechado) return;
      fechado = true;
      clearTimeout(relogio);
      pendentes.delete(pergunta.id);
      resolve({ respondida, resposta });
    };

    const relogio = setTimeout(() => {
      void patchSessao(sessaoId, { status: 'rodando', pergunta: null });
      void appendPasso(sessaoId, 'recusado', `A pergunta expirou depois de ${segundos}s sem resposta.`);
      terminar(`ninguém respondeu em ${segundos}s`, false);
    }, segundos * 1000);

    pendentes.set(pergunta.id, (r) => terminar(r, true));
  });
}

/** Chamado pela rota quando o dono envia o formulário preenchido. */
export async function responder(
  sessaoId: string,
  perguntaId: string,
  respostas: string[],
): Promise<boolean> {
  const entrega = pendentes.get(perguntaId);
  if (!entrega) return false;

  const sessao = getSessao(sessaoId);
  const itens = sessao?.pergunta?.itens ?? [];
  // O texto que o agente recebe casa pergunta com resposta: só a lista de
  // respostas o obrigaria a adivinhar a ordem.
  const texto = itens
    .map((it, i) => `${it.pergunta}\n→ ${respostas[i]?.trim() || '(sem resposta)'}`)
    .join('\n\n');

  await patchSessao(sessaoId, { status: 'rodando', pergunta: null });
  await appendPasso(sessaoId, 'agiu', `Você respondeu: ${respostas.filter(Boolean).join(' · ').slice(0, 200)}`);
  log('perguntas', 'dono respondeu', { sessao: sessaoId, respostas: respostas.length });

  entrega(texto);
  return true;
}

/** Reinício mata quem estava esperando: ninguém fica pendurado para sempre. */
export function limparPendentes(): void {
  for (const [, entrega] of pendentes) entrega('servidor reiniciou durante a espera');
  pendentes.clear();
}
