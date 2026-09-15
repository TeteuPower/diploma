import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './env';

/**
 * Log estruturado, em duas saídas ao mesmo tempo: stdout (para quem está
 * olhando o terminal) e `data/diploma.log` (para quem chega depois).
 *
 * Por que arquivo além do stdout: quando uma sessão quebra no meio, a trilha de
 * passos conta o QUE aconteceu, mas não o suficiente para consertar — falta o
 * erro cru do Playwright, o tamanho do instantâneo, quanto tempo cada ação
 * levou. Isso não cabe na UI e não deve poluir a trilha do dono, mas é
 * exatamente o que resolve o bug.
 *
 * A linha é `ISO [escopo] mensagem {json}`: legível a olho e ainda grepável.
 *
 * REGRA: nada de senha aqui. `autenticar` loga o usuário e o resultado, nunca
 * o segredo. Se um campo puder conter segredo, ele não entra no extra.
 */

const ARQUIVO = join(DATA_DIR, 'diploma.log');
const MAX_BYTES = 8 * 1024 * 1024;

let pronto = false;

function garantirArquivo(): void {
  if (pronto) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    // Rotação de um giro só: o log anterior vira .1 e o novo começa limpo.
    // Sem isso uma sessão longa enche o disco em silêncio.
    const s = statSync(ARQUIVO, { throwIfNoEntry: false });
    if (s && s.size > MAX_BYTES) renameSync(ARQUIVO, `${ARQUIVO}.1`);
  } catch {
    /* segue: log nunca pode derrubar o servidor */
  }
  pronto = true;
}

function serializar(extra: Record<string, unknown> | undefined): string {
  if (!extra) return '';
  try {
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) continue;
      limpo[k] = typeof v === 'string' && v.length > 600 ? `${v.slice(0, 600)}…` : v;
    }
    const json = JSON.stringify(limpo);
    return json === '{}' ? '' : ` ${json}`;
  } catch {
    return ' {"_erro":"extra não serializável"}';
  }
}

function escrever(nivel: string, escopo: string, mensagem: string, extra?: Record<string, unknown>) {
  const linha = `${new Date().toISOString()} ${nivel} [${escopo}] ${mensagem}${serializar(extra)}`;
  // stdout primeiro: se a escrita em disco falhar, a mensagem não se perde.
  console.log(linha);
  garantirArquivo();
  try {
    appendFileSync(ARQUIVO, `${linha}\n`, 'utf8');
  } catch {
    /* disco cheio ou arquivo travado: o stdout já saiu */
  }
}

export function log(escopo: string, mensagem: string, extra?: Record<string, unknown>): void {
  escrever('INFO ', escopo, mensagem, extra);
}

export function aviso(escopo: string, mensagem: string, extra?: Record<string, unknown>): void {
  escrever('AVISO', escopo, mensagem, extra);
}

export function erro(escopo: string, mensagem: string, err?: unknown, extra?: Record<string, unknown>): void {
  const detalhe = err instanceof Error ? err.message : err !== undefined ? String(err) : undefined;
  escrever('ERRO ', escopo, mensagem, { ...extra, erro: detalhe });
}

/** Cronômetro para medir o que demora — clique lento é sintoma, não detalhe. */
export function cronometro(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}

export const CAMINHO_LOG = ARQUIVO;
