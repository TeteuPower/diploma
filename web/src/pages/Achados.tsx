import { useMemo, useState } from 'react';
import type { Achado, Sessao, TipoAchado } from '@shared/types';
import { Panel, EmptyState, Badge, Select } from '../components/ui';
import { dataHora } from '../lib/modo';

/**
 * Os achados, reagrupados.
 *
 * O relato final é a conclusão em prosa. Isto é o material que a sustenta — cada
 * oferta, fato ou documento com a URL de onde saiu. Produto vira tabela ordenada
 * por preço, porque é assim que se compara; o resto vira cartão com a fonte ao
 * lado, porque é assim que se confere.
 */

const ROTULO_TIPO: Record<TipoAchado, string> = {
  produto: 'Produtos',
  fato: 'Fatos',
  documento: 'Documentos',
  pessoa: 'Pessoas',
  contato: 'Contatos',
  outro: 'Outros',
};

const ORDEM_TIPO: TipoAchado[] = ['produto', 'documento', 'fato', 'pessoa', 'contato', 'outro'];

const COR_CONFIANCA: Record<Achado['confianca'], string> = {
  alta: '#38e0d8',
  media: '#f5b955',
  baixa: '#f47174',
};

/** Preço como número, tolerando "R$ 2.899,90" quando o agente não obedeceu ao formato. */
function precoDe(a: Achado): number | null {
  const v = a.dados.preco;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[^\d.,]/g, '');
  // "2.899,90" → 2899.90 ; "2899.90" → 2899.90
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function hostDe(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
}

const texto = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

function Fonte({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[11px] text-accent/80 underline-offset-2 hover:underline"
      title={url}
    >
      {hostDe(url)} ↗
    </a>
  );
}

function Confianca({ c }: { c: Achado['confianca'] }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${COR_CONFIANCA[c]}22`, color: COR_CONFIANCA[c] }}
      title="Confiança declarada pelo agente"
    >
      {c}
    </span>
  );
}

function TabelaProdutos({ itens, onRemover }: { itens: Achado[]; onRemover: (id: string) => void }) {
  const ordenados = useMemo(
    () =>
      [...itens].sort((a, b) => {
        const pa = precoDe(a);
        const pb = precoDe(b);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa - pb;
      }),
    [itens],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/35">
            <th className="py-2 pr-3">Preço</th>
            <th className="py-2 pr-3">Oferta</th>
            <th className="py-2 pr-3">Vendedor · condição · frete</th>
            <th className="py-2 pr-3">Fonte</th>
            <th className="py-2 pr-3">Conf.</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ordenados.map((a, i) => {
            const p = precoDe(a);
            return (
              <tr
                key={a.id}
                className={`border-b border-white/5 align-top ${i === 0 && p !== null ? 'bg-accent/[0.06]' : ''}`}
              >
                <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-sm text-white/90">
                  {p !== null ? brl(p) : <span className="text-white/30">sem preço</span>}
                  {i === 0 && p !== null && (
                    <span className="ml-2 text-[10px] font-semibold text-accent">menor</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-white/85">{a.titulo}</div>
                  <div className="mt-0.5 text-white/45">{a.resumo}</div>
                </td>
                <td className="py-2.5 pr-3 text-white/55">
                  <div>{texto(a.dados.vendedor ?? a.dados.loja ?? a.dados.site)}</div>
                  <div className="text-white/35">
                    {texto(a.dados.condicao)}
                    {a.dados.frete !== undefined && a.dados.frete !== null ? ` · frete ${texto(a.dados.frete)}` : ''}
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <Fonte url={typeof a.dados.link === 'string' && a.dados.link ? a.dados.link : a.fonte} />
                </td>
                <td className="py-2.5 pr-3">
                  <Confianca c={a.confianca} />
                </td>
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    className="text-white/25 hover:text-accent-rose"
                    title="Descartar este achado"
                    onClick={() => onRemover(a.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cartao({ a, onRemover }: { a: Achado; onRemover: (id: string) => void }) {
  const campos = Object.entries(a.dados).filter(([, v]) => v !== null && v !== '' && v !== undefined);
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-white/90">{a.titulo}</h4>
        <div className="flex shrink-0 items-center gap-2">
          <Confianca c={a.confianca} />
          <button
            type="button"
            className="text-white/25 hover:text-accent-rose"
            title="Descartar este achado"
            onClick={() => onRemover(a.id)}
          >
            ✕
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs leading-relaxed text-white/60">{a.resumo}</p>
      {campos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {campos.map(([k, v]) => (
            <span key={k} className="chip">
              <span className="text-white/40">{k}:</span> {texto(v)}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-[11px] text-white/30">
        <Fonte url={a.fonte} />
        <span>{dataHora(a.capturadoEm)}</span>
      </div>
    </div>
  );
}

/** Para colar num e-mail ou numa nota: a mesma coisa, em Markdown. */
function paraMarkdown(achados: Achado[], sessao?: Sessao): string {
  const linhas: string[] = [];
  if (sessao) linhas.push(`# ${sessao.objetivo}`, '');
  for (const tipo of ORDEM_TIPO) {
    const grupo = achados.filter((a) => a.tipo === tipo);
    if (!grupo.length) continue;
    linhas.push(`## ${ROTULO_TIPO[tipo]}`, '');
    if (tipo === 'produto') {
      linhas.push('| Preço | Oferta | Vendedor | Condição | Frete | Fonte | Conf. |', '|---|---|---|---|---|---|---|');
      for (const a of [...grupo].sort((x, y) => (precoDe(x) ?? Infinity) - (precoDe(y) ?? Infinity))) {
        const p = precoDe(a);
        linhas.push(
          `| ${p !== null ? brl(p) : '—'} | ${a.titulo} | ${texto(a.dados.vendedor ?? a.dados.site)} | ${texto(a.dados.condicao)} | ${texto(a.dados.frete)} | ${typeof a.dados.link === 'string' ? a.dados.link : a.fonte} | ${a.confianca} |`,
        );
      }
    } else {
      for (const a of grupo) {
        linhas.push(`- **${a.titulo}** — ${a.resumo} (${a.fonte}) _[${a.confianca}]_`);
      }
    }
    linhas.push('');
  }
  return linhas.join('\n');
}

export function Achados({
  sessoes,
  achados,
  onRemover,
}: {
  sessoes: Sessao[];
  achados: Achado[];
  onRemover: (id: string) => void;
}) {
  // Sessões que têm achados, da mais recente para a mais antiga.
  const comAchados = useMemo(() => {
    const ids = new Set(achados.map((a) => a.sessaoId));
    return sessoes.filter((s) => ids.has(s.id));
  }, [sessoes, achados]);

  const [escolhida, setEscolhida] = useState<string>('');
  const sessaoId = escolhida || comAchados[0]?.id || '';
  const sessao = sessoes.find((s) => s.id === sessaoId);

  const visiveis = useMemo(
    () => (sessaoId ? achados.filter((a) => a.sessaoId === sessaoId) : achados),
    [achados, sessaoId],
  );

  const grupos = useMemo(
    () =>
      ORDEM_TIPO.map((tipo) => ({ tipo, itens: visiveis.filter((a) => a.tipo === tipo) })).filter(
        (g) => g.itens.length > 0,
      ),
    [visiveis],
  );

  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(paraMarkdown(visiveis, sessao));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      alert('Não consegui acessar a área de transferência.');
    }
  };

  if (!achados.length) {
    return (
      <Panel title="Achados" icon="🔎">
        <EmptyState icon="🕳️">
          Nada registrado ainda. Numa missão web, cada coisa que o agente encontra vira um achado
          aqui — com a fonte.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Panel
        title="O que ele encontrou"
        icon="🔎"
        accent="#38e0d8"
        right={
          <div className="flex items-center gap-2">
            <Badge>{visiveis.length} achados</Badge>
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => void copiar()}>
              {copiado ? 'Copiado ✓' : 'Copiar como Markdown'}
            </button>
          </div>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-white/45">
          Cada item traz a URL de onde saiu. A confiança é a que o agente declarou — "baixa" costuma
          ser preço sem frete, anúncio suspeito ou fonte única.
        </p>
        <Select value={sessaoId} onChange={(e) => setEscolhida(e.target.value)}>
          {comAchados.map((s) => (
            <option key={s.id} value={s.id}>
              {dataHora(s.criadaEm)} — {s.objetivo.slice(0, 90)}
            </option>
          ))}
        </Select>
      </Panel>

      {grupos.map(({ tipo, itens }) => (
        <Panel key={tipo} title={ROTULO_TIPO[tipo]} right={<Badge>{itens.length}</Badge>}>
          {tipo === 'produto' ? (
            <TabelaProdutos itens={itens} onRemover={onRemover} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {itens.map((a) => (
                <Cartao key={a.id} a={a} onRemover={onRemover} />
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
