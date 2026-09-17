import { PATHS } from './env';
import { JsonFile, agora, genId, sessaoEvents } from './store';
import { log } from './log';
import type { Achado, TipoAchado } from '../shared/types';

/**
 * Os achados: o que o agente encontrou, um a um, com fonte.
 *
 * Por que isto existe separado do relato final: o relato é a conclusão em
 * prosa ("o melhor preço é R$ 2.899 na loja X"). O achado é o material que
 * sustenta a conclusão — cada oferta, cada fato, cada documento, com a URL de
 * onde saiu. É o que permite ao dono conferir em vez de acreditar, e é o que
 * a página Achados reagrupa: tabela de produtos ordenada por preço, cartões
 * de fatos com a fonte ao lado.
 *
 * Sem fonte não é achado, é palpite — a ferramenta exige URL.
 */

const arquivo = new JsonFile<Achado[]>(PATHS.achados, []);

export async function initAchados(): Promise<void> {
  await arquivo.load();
}

export function listar(sessaoId?: string): Achado[] {
  const todos = arquivo.get();
  return sessaoId ? todos.filter((a) => a.sessaoId === sessaoId) : todos;
}

export async function registrar(input: {
  sessaoId: string;
  tipo: TipoAchado;
  titulo: string;
  resumo: string;
  dados: Record<string, string | number | boolean | null>;
  fonte: string;
  confianca: Achado['confianca'];
}): Promise<Achado> {
  const achado: Achado = {
    id: genId('ach'),
    sessaoId: input.sessaoId,
    tipo: input.tipo,
    titulo: input.titulo.trim().slice(0, 200),
    resumo: input.resumo.trim().slice(0, 2000),
    dados: input.dados,
    fonte: input.fonte.trim(),
    confianca: input.confianca,
    capturadoEm: agora(),
  };
  arquivo.setSync([...arquivo.get(), achado]);
  await arquivo.flush();
  // O mesmo hub SSE das sessões: a página Achados enche ao vivo.
  sessaoEvents.emit('achado', achado);
  log('achados', 'registrado', {
    sessao: input.sessaoId,
    tipo: achado.tipo,
    titulo: achado.titulo.slice(0, 80),
    fonte: achado.fonte.slice(0, 120),
  });
  return achado;
}

export async function remover(id: string): Promise<boolean> {
  const antes = arquivo.get();
  const depois = antes.filter((a) => a.id !== id);
  if (depois.length === antes.length) return false;
  arquivo.setSync(depois);
  await arquivo.flush();
  return true;
}

/** Apaga os achados de uma sessão junto com ela. */
export async function removerDaSessao(sessaoId: string): Promise<number> {
  const antes = arquivo.get();
  const depois = antes.filter((a) => a.sessaoId !== sessaoId);
  if (depois.length === antes.length) return 0;
  arquivo.setSync(depois);
  await arquivo.flush();
  return antes.length - depois.length;
}
