import { promises as fs } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { PROJECT_ROOT } from './env';
import { log, aviso } from './log';

/**
 * A área onde o agente produz os entregáveis.
 *
 * Mesma filosofia da fronteira de domínio: **a parede é código**. O agente não
 * tem Read/Write/Bash do Claude Code (ficam em `disallowedTools`) justamente
 * para não ter a máquina inteira ao alcance. Estas ferramentas dão a ele
 * exatamente uma pasta — `trabalhos/` — e nada além dela.
 *
 * Por que uma pasta e não a raiz do projeto: o que sai daqui é trabalho
 * acadêmico do dono, não código desta aplicação. Misturar os dois faria o
 * agente editar a si mesmo por acidente, e faria o `git status` do projeto
 * virar lixo.
 */

export const RAIZ_TRABALHOS = join(PROJECT_ROOT, 'trabalhos');

/** Teto por arquivo. Entregável acadêmico não passa disso; loop de escrita sim. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ARQUIVOS = 300;

/**
 * Resolve um caminho relativo garantindo que ele fique dentro de `trabalhos/`.
 *
 * A checagem é feita depois de `resolve()`, no caminho absoluto: comparar
 * strings antes de normalizar deixa passar `a/../../etc/senha`. Symlink não é
 * tratado — a pasta é criada por nós e o agente não tem como plantar um.
 */
export function resolverCaminho(rel: string): string {
  if (typeof rel !== 'string' || !rel.trim()) {
    throw new Error('caminho vazio');
  }
  const limpo = rel.trim().replace(/\\/g, '/');
  if (limpo.startsWith('/') || /^[a-zA-Z]:/.test(limpo)) {
    throw new Error(`caminho precisa ser relativo a trabalhos/: recebi "${rel}"`);
  }
  // Nada de nome esquisito que o Windows recusa ou que confunde ferramenta.
  if (/[<>:"|?*\x00-\x1f]/.test(limpo)) {
    throw new Error(`caminho tem caractere inválido: "${rel}"`);
  }

  const absoluto = resolve(RAIZ_TRABALHOS, limpo);
  const dentro = relative(RAIZ_TRABALHOS, absoluto);
  if (dentro.startsWith('..') || dentro.startsWith(`..${sep}`) || resolve(dentro) === dentro) {
    throw new Error(`fora da pasta de trabalhos: "${rel}". Escrita recusada.`);
  }
  return absoluto;
}

export async function escrever(rel: string, conteudo: string): Promise<{ bytes: number }> {
  const destino = resolverCaminho(rel);
  const bytes = Buffer.byteLength(conteudo, 'utf8');
  if (bytes > MAX_BYTES) {
    throw new Error(`arquivo com ${bytes} bytes passa do teto de ${MAX_BYTES}`);
  }
  await fs.mkdir(dirname(destino), { recursive: true });
  await fs.writeFile(destino, conteudo, 'utf8');
  log('trabalhos', 'arquivo gravado', { caminho: rel, bytes });
  return { bytes };
}

export async function gravarBinario(rel: string, dados: Buffer): Promise<{ bytes: number }> {
  const destino = resolverCaminho(rel);
  if (dados.byteLength > MAX_BYTES * 8) {
    throw new Error(`anexo com ${dados.byteLength} bytes é grande demais`);
  }
  await fs.mkdir(dirname(destino), { recursive: true });
  await fs.writeFile(destino, dados);
  log('trabalhos', 'anexo gravado', { caminho: rel, bytes: dados.byteLength });
  return { bytes: dados.byteLength };
}

export async function ler(rel: string): Promise<string> {
  const origem = resolverCaminho(rel);
  return fs.readFile(origem, 'utf8');
}

export interface ItemTrabalho {
  caminho: string;
  bytes: number;
  modificadoEm: string;
}

/** Lista recursivamente o que existe na pasta. Vazio quando nada foi criado. */
export async function listar(subpasta = ''): Promise<ItemTrabalho[]> {
  const base = subpasta ? resolverCaminho(subpasta) : RAIZ_TRABALHOS;
  const achados: ItemTrabalho[] = [];

  async function andar(dir: string): Promise<void> {
    if (achados.length >= MAX_ARQUIVOS) return;
    let entradas;
    try {
      entradas = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // pasta ainda não existe
    }
    for (const e of entradas) {
      if (achados.length >= MAX_ARQUIVOS) return;
      const cheio = join(dir, e.name);
      if (e.isDirectory()) {
        await andar(cheio);
      } else {
        const st = await fs.stat(cheio);
        achados.push({
          caminho: relative(RAIZ_TRABALHOS, cheio).replace(/\\/g, '/'),
          bytes: st.size,
          modificadoEm: st.mtime.toISOString(),
        });
      }
    }
  }

  await andar(base);
  return achados.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

export async function apagar(rel: string): Promise<boolean> {
  const alvo = resolverCaminho(rel);
  try {
    await fs.unlink(alvo);
    aviso('trabalhos', 'arquivo apagado', { caminho: rel });
    return true;
  } catch {
    return false;
  }
}

export async function initTrabalhos(): Promise<void> {
  await fs.mkdir(RAIZ_TRABALHOS, { recursive: true });
}
