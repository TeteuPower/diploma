import { getConfig } from './store';
import * as cofre from './cofre';
import { log, erro as logErro, cronometro } from './log';

/**
 * Brave Search por API.
 *
 * Por que além do navegador: abrir um buscador pelo Chromium funciona, mas é
 * lento, gasta instantâneo e esbarra em "verifique que é humano". A API devolve
 * dez links em meio segundo, sem captcha. O agente usa isto para descobrir ONDE
 * procurar e o navegador para ler o que achou.
 *
 * A chave é segredo e mora no **cofre**, cifrada pelo DPAPI como uma senha
 * qualquer. Ela sai do cofre, vai no header para a Brave e acaba ali — nunca
 * entra no contexto da LLM, que só recebe título, URL e descrição. Mesma
 * garantia da senha do LMS, pelo mesmo caminho.
 */

export const HOST_BRAVE = 'api.search.brave.com';
const USUARIO_BRAVE = 'brave-search';
const URL_COFRE = `https://${HOST_BRAVE}`;

export function configurada(): boolean {
  return cofre.paraUrl(URL_COFRE) !== undefined;
}

export async function guardarChave(chave: string): Promise<void> {
  const limpa = chave.trim();
  if (!limpa) throw new Error('chave vazia');
  await cofre.guardar({
    dominio: HOST_BRAVE,
    usuario: USUARIO_BRAVE,
    senha: limpa,
    rotulo: 'Brave Search API',
  });
  log('brave', 'chave guardada no cofre');
}

export async function removerChave(): Promise<boolean> {
  const meta = cofre.paraUrl(URL_COFRE);
  if (!meta) return false;
  const ok = await cofre.remover(meta.id);
  if (ok) log('brave', 'chave removida do cofre');
  return ok;
}

export interface ResultadoBusca {
  titulo: string;
  url: string;
  descricao: string;
}

export async function buscar(consulta: string, quantidade = 10): Promise<ResultadoBusca[]> {
  const meta = cofre.paraUrl(URL_COFRE);
  if (!meta) {
    throw new Error('Brave Search não configurado: cadastre a chave em Configuração → Brave Search.');
  }
  // O único ponto em que a chave existe em claro do lado do Node — e ela vai
  // direto para o header, sem passar por log nem por resposta de ferramenta.
  const segredo = await cofre.revelarParaNavegador(meta.id);
  if (!segredo) throw new Error('a chave do Brave não pôde ser lida do cofre');

  const pais = getConfig().brave.pais.trim().toUpperCase();
  const u = new URL(`https://${HOST_BRAVE}/res/v1/web/search`);
  u.searchParams.set('q', consulta.trim());
  u.searchParams.set('count', String(Math.min(20, Math.max(1, Math.round(quantidade)))));
  if (pais) u.searchParams.set('country', pais);

  const medir = cronometro();
  const res = await fetch(u, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': segredo.senha },
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`Brave respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const itens = (json.web?.results ?? [])
    .filter((r) => typeof r.url === 'string' && r.url)
    .map((r) => ({ titulo: r.title ?? '', url: r.url as string, descricao: r.description ?? '' }));

  log('brave', 'busca', {
    consulta: consulta.slice(0, 120),
    pais: pais || '(global)',
    resultados: itens.length,
    ms: medir(),
  });
  return itens;
}

/** Uma busca curta para o dono ver que a chave funciona, sem sair da Configuração. */
export async function testar(): Promise<{ ok: boolean; detalhe: string; amostra: ResultadoBusca[] }> {
  try {
    const r = await buscar('brave search api', 3);
    return { ok: true, detalhe: `${r.length} resultado(s) em ${getConfig().brave.pais || 'global'}`, amostra: r };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    logErro('brave', 'teste falhou', err);
    return { ok: false, detalhe: m, amostra: [] };
  }
}
