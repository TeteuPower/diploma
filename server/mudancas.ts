import { PATHS } from './env';
import { JsonFile, agora, genId } from './store';
import { log } from './log';
import type { MudancaSistema } from '../shared/types';

/**
 * O diário do que o agente mexeu na máquina.
 *
 * Por que isto existe separado da trilha da sessão: a trilha conta o turno e
 * some do radar quando a sessão fecha. Mudança em PC é diferente — ela
 * continua valendo semana que vem, quando o dono não lembra mais que pediu, e
 * a pergunta que ele vai fazer é "o que foi que mexeram aqui, e como eu
 * desfaço?". Isso precisa de um lugar próprio, que sobreviva à sessão.
 *
 * Por isso a ferramenta EXIGE `comoDesfazer`: não é burocracia, é o que
 * transforma "mudei uma configuração" em algo reversível pelo dono sozinho.
 */

const arquivo = new JsonFile<MudancaSistema[]>(PATHS.mudancas, []);

export async function initMudancas(): Promise<void> {
  await arquivo.load();
}

export function listar(): MudancaSistema[] {
  return [...arquivo.get()].reverse(); // a mais recente primeiro
}

export async function registrar(input: {
  sessaoId: string;
  oQueMuda: string;
  comando: string;
  comoDesfazer: string;
  saida: string;
  ok: boolean;
}): Promise<MudancaSistema> {
  const m: MudancaSistema = {
    id: genId('mud'),
    sessaoId: input.sessaoId,
    oQueMuda: input.oQueMuda.trim().slice(0, 500),
    comando: input.comando.trim().slice(0, 2000),
    comoDesfazer: input.comoDesfazer.trim().slice(0, 2000),
    saida: input.saida.slice(0, 2000),
    ok: input.ok,
    desfeitaEm: null,
    em: agora(),
  };
  arquivo.setSync([...arquivo.get(), m]);
  await arquivo.flush();
  log('mudancas', 'registrada', { id: m.id, ok: m.ok, oQueMuda: m.oQueMuda.slice(0, 100) });
  return m;
}

/** O dono marcou como desfeita (ele mesmo rodou o comando de volta). */
export async function marcarDesfeita(id: string): Promise<boolean> {
  let achou = false;
  const next = arquivo.get().map((m) => {
    if (m.id !== id || m.desfeitaEm) return m;
    achou = true;
    return { ...m, desfeitaEm: agora() };
  });
  if (!achou) return false;
  arquivo.setSync(next);
  await arquivo.flush();
  log('mudancas', 'marcada como desfeita', { id });
  return true;
}
