import { PATHS } from './env';
import { JsonFile, agora, genId } from './store';
import { proteger, desproteger, dpapiDisponivel } from './dpapi';
import type { CredencialMeta, EstadoCofre } from '../shared/types';

/**
 * Cofre de credenciais.
 *
 * A regra que governa este arquivo: **a senha nunca sai daqui em texto claro,
 * exceto para o navegador**. Ela não é devolvida por nenhuma rota HTTP, não vai
 * para a UI e — o que mais importa — nunca entra no contexto da LLM. A
 * ferramenta `autenticar` pede a senha a este módulo e a digita direto no campo
 * do Playwright; o agente só recebe de volta "deu certo" ou "falhou".
 */

/** O que fica no disco: metadados + o blob DPAPI. */
interface Entrada extends CredencialMeta {
  segredo: string; // base64 do blob DPAPI
}

const cofreFile = new JsonFile<Entrada[]>(PATHS.cofre, []);

let estadoDpapi: { ok: boolean; motivo: string | null } = {
  ok: false,
  motivo: 'ainda não verificado',
};

export async function initCofre(): Promise<void> {
  await cofreFile.load();
  estadoDpapi = await dpapiDisponivel();
}

function semSegredo(e: Entrada): CredencialMeta {
  const { segredo: _segredo, ...meta } = e;
  return meta;
}

export function estado(): EstadoCofre {
  return {
    disponivel: estadoDpapi.ok,
    motivo: estadoDpapi.motivo,
    credenciais: cofreFile.get().map(semSegredo),
  };
}

export function total(): number {
  return cofreFile.get().length;
}

export function disponivel(): { ok: boolean; motivo: string | null } {
  return estadoDpapi;
}

/** Normaliza para host puro, para casar credencial com domínio do alvo. */
export function hostDe(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export async function guardar(input: {
  dominio: string;
  usuario: string;
  senha: string;
  rotulo?: string;
}): Promise<CredencialMeta> {
  if (!estadoDpapi.ok) {
    throw new Error(`cofre indisponível: ${estadoDpapi.motivo ?? 'DPAPI não respondeu'}`);
  }
  const dominio = hostDe(input.dominio);
  const segredo = await proteger(input.senha);

  const entrada: Entrada = {
    id: genId('cred'),
    dominio,
    usuario: input.usuario.trim(),
    rotulo: input.rotulo?.trim() || dominio,
    criadaEm: agora(),
    usadaEm: null,
    segredo,
  };

  // Uma credencial por (domínio, usuário): regravar substitui em vez de duplicar.
  const resto = cofreFile
    .get()
    .filter((e) => !(e.dominio === dominio && e.usuario === entrada.usuario));
  cofreFile.setSync([...resto, entrada]);
  await cofreFile.flush();
  return semSegredo(entrada);
}

export async function remover(id: string): Promise<boolean> {
  const antes = cofreFile.get();
  const depois = antes.filter((e) => e.id !== id);
  if (depois.length === antes.length) return false;
  cofreFile.setSync(depois);
  await cofreFile.flush();
  return true;
}

/** Acha a credencial que serve para uma URL (casa pelo host). */
export function paraUrl(url: string): CredencialMeta | undefined {
  const host = hostDe(url);
  const achou = cofreFile
    .get()
    .find((e) => e.dominio === host || host.endsWith(`.${e.dominio}`));
  return achou ? semSegredo(achou) : undefined;
}

/**
 * Entrega usuário + senha em claro. ÚNICO ponto do sistema que faz isso, e só
 * o navegador o chama. Nenhuma rota HTTP expõe esta função.
 */
export async function revelarParaNavegador(
  id: string,
): Promise<{ usuario: string; senha: string } | null> {
  const entrada = cofreFile.get().find((e) => e.id === id);
  if (!entrada) return null;
  const senha = await desproteger(entrada.segredo);
  // Registra o uso (auditoria mínima: quando aquela credencial foi digitada).
  cofreFile.setSync(
    cofreFile.get().map((e) => (e.id === id ? { ...e, usadaEm: agora() } : e)),
  );
  void cofreFile.flush();
  return { usuario: entrada.usuario, senha };
}
