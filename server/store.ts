import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, PATHS } from './env';
import { DEFAULT_CONFIG } from './defaults';
import type { DiplomaConfig, Sessao, Passo, TipoPasso } from '../shared/types';

export const agora = () => new Date().toISOString();
export const genId = (prefixo: string) => `${prefixo}-${randomUUID().slice(0, 8)}`;

/**
 * Arquivo JSON com escrita atômica e fila por-arquivo. A escrita é serializada
 * (mutex por promise-chain): a config que o dono edita na UI e os passos que o
 * agente grava em tempo real nunca se sobrescrevem.
 */
export class JsonFile<T> {
  private value: T;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string, private readonly fallback: T) {
    this.value = fallback;
  }

  get(): T {
    return this.value;
  }

  setSync(v: T): void {
    this.value = v;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      this.value = JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.value = this.fallback;
        await this.flush();
      } else {
        throw err;
      }
    }
  }

  flush(): Promise<void> {
    const json = JSON.stringify(this.value, null, 2);
    this.chain = this.chain
      .then(async () => {
        const tmp = `${this.path}.${process.pid}.tmp`;
        await fs.writeFile(tmp, json, 'utf8');
        await fs.rename(tmp, this.path);
      })
      .catch((err) => {
        console.error(`[store] falha ao gravar ${this.path}:`, err);
      });
    return this.chain;
  }
}

const configFile = new JsonFile<DiplomaConfig>(PATHS.config, DEFAULT_CONFIG);
const sessoesFile = new JsonFile<Sessao[]>(PATHS.sessoes, []);

export const sessaoEvents = new EventEmitter();

export async function initStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await Promise.all([configFile.load(), sessoesFile.load()]);
  // Migração leve: campos novos da config ganham o default sem perder o salvo.
  const merged: DiplomaConfig = {
    ...DEFAULT_CONFIG,
    ...configFile.get(),
    alvo: { ...DEFAULT_CONFIG.alvo, ...configFile.get().alvo },
    navegador: { ...DEFAULT_CONFIG.navegador, ...configFile.get().navegador },
  };
  configFile.setSync(merged);
  await configFile.flush();
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(): DiplomaConfig {
  return configFile.get();
}

export async function patchConfig(patch: Partial<DiplomaConfig>): Promise<DiplomaConfig> {
  const atual = configFile.get();
  const next: DiplomaConfig = {
    ...atual,
    ...patch,
    alvo: patch.alvo ? { ...atual.alvo, ...patch.alvo } : atual.alvo,
    navegador: patch.navegador ? { ...atual.navegador, ...patch.navegador } : atual.navegador,
  };
  configFile.setSync(next);
  await configFile.flush();
  return next;
}

// ---------------------------------------------------------------------------
// Sessões (dono do dado = servidor)
// ---------------------------------------------------------------------------

export function listSessoes(): Sessao[] {
  return sessoesFile.get();
}

export function getSessao(id: string): Sessao | undefined {
  return sessoesFile.get().find((s) => s.id === id);
}

export async function createSessao(sessao: Sessao): Promise<Sessao> {
  // Persistida assim que nasce — sobrevive a reinício.
  sessoesFile.setSync([sessao, ...sessoesFile.get()]);
  await sessoesFile.flush();
  sessaoEvents.emit('sessao', sessao);
  return sessao;
}

export async function patchSessao(id: string, patch: Partial<Sessao>): Promise<Sessao | undefined> {
  let updated: Sessao | undefined;
  const next = sessoesFile.get().map((s) => {
    if (s.id !== id) return s;
    updated = { ...s, ...patch, id: s.id, atualizadaEm: agora() };
    return updated;
  });
  if (!updated) return undefined;
  sessoesFile.setSync(next);
  await sessoesFile.flush();
  sessaoEvents.emit('sessao', updated);
  return updated;
}

/** Acrescenta um passo à trilha sem sobrescrever os existentes. */
export async function appendPasso(
  id: string,
  tipo: TipoPasso,
  resumo: string,
  extra: { ferramenta?: string; url?: string } = {},
): Promise<Sessao | undefined> {
  const sessao = getSessao(id);
  if (!sessao) return undefined;
  const passo: Passo = { id: genId('p'), at: agora(), tipo, resumo, ...extra };
  return patchSessao(id, {
    passos: [...sessao.passos, passo],
    urlAtual: extra.url ?? sessao.urlAtual,
  });
}

export async function deleteSessao(id: string): Promise<boolean> {
  const before = sessoesFile.get();
  const next = before.filter((s) => s.id !== id);
  if (next.length === before.length) return false;
  sessoesFile.setSync(next);
  await sessoesFile.flush();
  sessaoEvents.emit('removida', id);
  return true;
}

/**
 * Sessões que ficaram 'rodando'/'aguardando' quando o processo morreu não têm
 * runner vivo nem ferramenta bloqueada esperando: viram 'interrompida' para não
 * ficarem mentindo no painel.
 */
export async function recuperarOrfas(): Promise<number> {
  const orfas = sessoesFile
    .get()
    .filter((s) => s.status === 'rodando' || s.status === 'aguardando');
  for (const s of orfas) {
    const passo: Passo = {
      id: genId('p'),
      at: agora(),
      tipo: 'status',
      resumo: 'Servidor reiniciado: sessão marcada como interrompida.',
    };
    await patchSessao(s.id, {
      status: 'interrompida',
      pendente: null,
      passos: [...s.passos, passo],
    });
  }
  return orfas.length;
}
