import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROJECT_ROOT, INSTALADO, VERSION, REPOSITORIO_PADRAO } from './env';
import { getConfig } from './store';
import { log, aviso, erro as logErro, cronometro } from './log';

/**
 * Atualização por dentro do app, pelo mesmo contrato do Claude Indicator:
 *
 * 1. Lista as releases do repositório e escolhe a MAIOR versão — não a
 *    "latest" da API, que ignora pré-release e é justamente como sai a build de
 *    cada push. A versão vem da tag quando ela é numérica (`v1.2.0`); quando a
 *    tag é um canal fixo (`latest`), vem do nome do instalador anexado, que é
 *    `Diploma-Setup-X.Y.Z.exe`.
 * 2. Baixa o instalador para a pasta temporária, com progresso.
 * 3. Roda em modo silencioso. O instalador já sabe se atualizar no lugar:
 *    fecha o app, troca a pasta, reabre. Este processo morre no meio — é o
 *    esperado, e por isso ele não tenta fazer nada depois de disparar.
 *
 * Rodando do código-fonte (sem `.instalado`), verificar funciona e instalar é
 * recusado: a troca de arquivos seria em cima do repositório.
 */

export interface InfoAtualizacao {
  versao: string;
  tag: string;
  notas: string;
  urlDownload: string;
  urlPagina: string;
  bytes: number;
}

export interface Andamento {
  fase: 'baixando' | 'instalando' | 'erro';
  progresso: number; // 0..1
  detalhe: string;
}

let ultimaChecagem = 0;
let disponivel: InfoAtualizacao | null = null;
let andamento: Andamento | null = null;

/** Intervalo mínimo entre consultas não forçadas: a API pública dá 60/hora. */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Versões — puras, exportadas para teste
// ---------------------------------------------------------------------------

/** "v1.4.0" e "1.4.0" viram "1.4.0". */
export function normalizarVersao(tag: string): string {
  const t = tag.trim();
  return t.replace(/^v/i, '');
}

/** "1.2" → [1,2,0]; "1.2.3-beta" → [1,2,3]; lixo → null. */
export function partesDe(v: string): number[] | null {
  const core = normalizarVersao(v).split(/[-+]/)[0];
  if (!/^\d+(\.\d+){0,3}$/.test(core)) return null;
  const p = core.split('.').map(Number);
  while (p.length < 3) p.push(0);
  return p;
}

/** Compara campo a campo; texto que não é versão nunca é "mais novo". */
export function ehMaisNova(candidata: string, atual: string): boolean {
  const a = partesDe(candidata);
  const b = partesDe(atual);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Extrai "1.5.0" de "Diploma-Setup-1.5.0.exe" ou "Build 1.5.0 (master)". */
export function versaoDoNome(texto: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/.exec(texto);
  return m ? m[1] : null;
}

interface ReleaseBruta {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

/**
 * Lê uma release. Uma release pode ter mais de um instalador anexado (builds
 * anteriores que ficaram); vale o de maior versão, nunca o primeiro da lista.
 * Prioridade da versão: tag numérica > nome do instalador > nome da release.
 */
export function analisarRelease(rel: ReleaseBruta, repo: string): InfoAtualizacao | null {
  const tag = rel.tag_name ?? '';
  const info: InfoAtualizacao = {
    versao: '',
    tag,
    notas: rel.body ?? '',
    urlDownload: '',
    urlPagina: rel.html_url ?? `https://github.com/${repo}/releases`,
    bytes: 0,
  };

  let versaoDoAsset: string | null = null;
  for (const a of rel.assets ?? []) {
    const nome = a.name ?? '';
    if (!/\.exe$/i.test(nome) || !/^Diploma-Setup-/i.test(nome)) continue;
    const v = versaoDoNome(nome);
    const melhor = versaoDoAsset === null || (v !== null && ehMaisNova(v, versaoDoAsset));
    if (!melhor) continue;
    versaoDoAsset = v ?? versaoDoAsset;
    info.urlDownload = a.browser_download_url ?? '';
    info.bytes = a.size ?? 0;
  }

  const daTag = normalizarVersao(tag);
  info.versao = partesDe(daTag) ? daTag : (versaoDoAsset ?? versaoDoNome(rel.name ?? '') ?? '');

  return info.versao && info.urlDownload ? info : null;
}

/** Entre várias releases, a maior versão elegível. */
export function escolher(
  releases: ReleaseBruta[],
  repo: string,
  incluirPreReleases: boolean,
): InfoAtualizacao | null {
  let melhor: InfoAtualizacao | null = null;
  for (const rel of releases) {
    if (rel.draft) continue;
    if (rel.prerelease && !incluirPreReleases) continue;
    const info = analisarRelease(rel, repo);
    if (!info) continue;
    if (!melhor || ehMaisNova(info.versao, melhor.versao)) melhor = info;
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Estado e operações
// ---------------------------------------------------------------------------

export function estado() {
  return {
    versaoAtual: VERSION,
    instalado: INSTALADO,
    disponivel,
    ultimaChecagem: ultimaChecagem ? new Date(ultimaChecagem).toISOString() : null,
    andamento,
  };
}

function repositorio(): string {
  return (getConfig().atualizacao.repositorio || REPOSITORIO_PADRAO).trim();
}

export async function verificar(forcar = false): Promise<InfoAtualizacao | null> {
  const cfg = getConfig().atualizacao;
  if (!forcar) {
    if (!cfg.verificar) return null;
    if (Date.now() - ultimaChecagem < INTERVALO_MS) return disponivel;
  }

  const repo = repositorio();
  const medir = cronometro();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
      headers: {
        Accept: 'application/vnd.github+json',
        // A API do GitHub exige User-Agent identificável.
        'User-Agent': `Diploma/${VERSION}`,
      },
    });
    ultimaChecagem = Date.now();
    if (!res.ok) {
      aviso('atualizacao', 'GitHub respondeu erro', { status: res.status, repo });
      return null;
    }
    const lista = (await res.json()) as ReleaseBruta[];
    const melhor = Array.isArray(lista) ? escolher(lista, repo, cfg.preReleases) : null;

    disponivel = melhor && ehMaisNova(melhor.versao, VERSION) ? melhor : null;
    log('atualizacao', 'verificou', {
      repo,
      atual: VERSION,
      maisNova: melhor?.versao ?? '(nenhuma)',
      disponivel: disponivel?.versao ?? null,
      ms: medir(),
    });
    return disponivel;
  } catch (err) {
    // Sem rede, repositório privado, formato inesperado: silencioso de propósito.
    ultimaChecagem = Date.now();
    aviso('atualizacao', 'não deu para verificar', { motivo: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** A pasta do app é gravável? Se não for, a troca precisa de elevação. */
async function precisaElevar(): Promise<boolean> {
  const sonda = join(PROJECT_ROOT, '.update-probe.tmp');
  try {
    await fs.writeFile(sonda, 'x');
    await fs.unlink(sonda);
    return false;
  } catch {
    return true;
  }
}

/**
 * Baixa e dispara o instalador. Devolve assim que o instalador foi iniciado —
 * o resto é com ele (fecha este processo, troca, reabre).
 */
export async function baixarEInstalar(): Promise<{ ok: boolean; motivo: string }> {
  if (!INSTALADO) {
    return {
      ok: false,
      motivo: 'rodando do código-fonte: atualize com git pull. O instalador só troca uma instalação.',
    };
  }
  if (andamento && andamento.fase !== 'erro') {
    return { ok: false, motivo: 'já há uma atualização em andamento' };
  }
  const info = disponivel ?? (await verificar(true));
  if (!info) return { ok: false, motivo: 'nenhuma versão mais nova disponível' };

  const dir = join(tmpdir(), 'DiplomaUpdate');
  await fs.mkdir(dir, { recursive: true });
  const destino = join(dir, `Diploma-Setup-${info.versao}.exe`);

  andamento = { fase: 'baixando', progresso: 0, detalhe: `baixando ${info.versao}` };
  const medir = cronometro();

  try {
    const res = await fetch(info.urlDownload, { headers: { 'User-Agent': `Diploma/${VERSION}` } });
    if (!res.ok || !res.body) throw new Error(`download respondeu ${res.status}`);

    const total = Number(res.headers.get('content-length')) || info.bytes || 0;
    let lidos = 0;
    const arquivo = createWriteStream(destino);
    const leitor = res.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      arquivo.write(Buffer.from(value));
      lidos += value.byteLength;
      if (total > 0) andamento.progresso = Math.min(1, lidos / total);
    }
    await new Promise<void>((r, j) => arquivo.end((e?: Error | null) => (e ? j(e) : r())));

    log('atualizacao', 'instalador baixado', { versao: info.versao, bytes: lidos, ms: medir() });

    andamento = { fase: 'instalando', progresso: 1, detalhe: 'iniciando o instalador' };
    const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'];

    if (await precisaElevar()) {
      // Silencioso, o instalador não tem como pedir elevação sozinho: quem pede
      // é o app, via Start-Process -Verb RunAs. O Windows mostra a confirmação.
      const ps = spawn(
        'powershell.exe',
        [
          '-NoProfile', '-NonInteractive', '-Command',
          `Start-Process -FilePath '${destino.replace(/'/g, "''")}' -ArgumentList '${args.join(' ')}' -Verb RunAs`,
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      ps.unref();
    } else {
      const filho = spawn(destino, args, { detached: true, stdio: 'ignore' });
      filho.unref();
    }

    log('atualizacao', 'instalador disparado — este processo será encerrado por ele', { versao: info.versao });
    return { ok: true, motivo: `instalando ${info.versao}; o Diploma vai fechar e reabrir sozinho` };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    andamento = { fase: 'erro', progresso: 0, detalhe: motivo };
    logErro('atualizacao', 'falhou', err);
    return { ok: false, motivo };
  }
}
