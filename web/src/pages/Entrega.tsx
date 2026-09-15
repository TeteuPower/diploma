import { useCallback, useEffect, useState } from 'react';
import type { PainelEntrega, Atividade } from '@shared/types';
import { Panel, EmptyState, Badge } from '../components/ui';
import { getEntrega } from '../api';

/**
 * O painel de entrega.
 *
 * A distinção que esta tela existe para fazer: o "Relato final" no Painel é o
 * agente contando, em prosa, o que acha que fez. Aqui é a aplicação conferindo
 * no disco — quais arquivos existem, se o PDF é mesmo um PDF, o que está dentro
 * do ZIP, se sobrou recado interno. Uma coisa é julgamento, a outra é fato, e o
 * dono precisa saber qual está lendo antes de enviar para o professor.
 */

const kb = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

function Linha({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs leading-relaxed">
      <span className={ok ? 'text-accent' : 'text-accent-amber'}>{ok ? '✓' : '⚠'}</span>
      <span className={ok ? 'text-white/60' : 'text-accent-amber/90'}>{children}</span>
    </div>
  );
}

function CartaoAtividade({ a }: { a: Atividade }) {
  const [abertoZip, setAbertoZip] = useState(false);
  const pdfsOk = a.pdfs.length > 0 && a.pdfs.every((p) => p.pdfValido);
  const zipLimpo = a.zip ? a.zip.itensInternos.length === 0 : false;

  return (
    <div className="glass p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-sm font-semibold text-white/90">{a.pasta}</h3>
        <div className="flex gap-2">
          <Badge>{a.arquivos.length} arquivos</Badge>
          <Badge>{kb(a.bytes)}</Badge>
        </div>
      </header>

      <div className="mb-4 space-y-1.5">
        <Linha ok={Boolean(a.zip)}>
          {a.zip
            ? <>Pacote <span className="font-mono text-white/80">{a.zip.caminho}</span> ({kb(a.zip.bytes)}, {a.zip.itens.length} itens)</>
            : 'Nenhum ZIP gerado para esta atividade.'}
        </Linha>

        {a.zip && (
          <Linha ok={zipLimpo}>
            {zipLimpo
              ? 'O pacote não contém nenhum recado interno.'
              : `O pacote contém ${a.zip.itensInternos.length} item(ns) interno(s): ${a.zip.itensInternos.join(', ')}`}
          </Linha>
        )}

        <Linha ok={pdfsOk}>
          {a.pdfs.length === 0
            ? 'Nenhum PDF nesta pasta — confira se o enunciado exige.'
            : pdfsOk
              ? `${a.pdfs.length} PDF(s), assinatura conferida.`
              : 'Há arquivo .pdf que NÃO é um PDF válido.'}
        </Linha>

        <Linha ok={a.suspeitas.length === 0}>
          {a.suspeitas.length === 0
            ? 'Nenhum recado ao dono dentro dos arquivos de entrega.'
            : `${a.suspeitas.length} trecho(s) parecem recado ao dono — confira antes de enviar.`}
        </Linha>
      </div>

      {a.suspeitas.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg border border-accent-amber/25 bg-accent-amber/[0.06] p-3">
          {a.suspeitas.map((s, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-accent-amber/85">
              <span className="text-white/40">{s.caminho}:{s.linha}</span> {s.trecho}
            </li>
          ))}
        </ul>
      )}

      <details className="group" open={abertoZip} onToggle={(e) => setAbertoZip(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none text-xs text-white/40 hover:text-white/70">
          {abertoZip ? '▲' : '▼'} arquivos
        </summary>
        <ul className="mt-2 space-y-0.5">
          {a.arquivos.map((f) => (
            <li key={f.caminho} className="flex justify-between gap-3 font-mono text-[11px] text-white/45">
              <span className="truncate">{f.caminho.slice(a.pasta.length + 1)}</span>
              <span className="shrink-0 text-white/25">{kb(f.bytes)}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function Entrega() {
  const [painel, setPainel] = useState<PainelEntrega | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setPainel(await getEntrega());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (erro) {
    return (
      <Panel title="Entrega" icon="📦">
        <EmptyState icon="⚠️">{erro}</EmptyState>
      </Panel>
    );
  }
  if (!painel) return null;

  const { totais } = painel;
  const tudoLimpo = totais.suspeitas === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Panel
        title="O que a aplicação conferiu no disco"
        icon="🔍"
        accent={tudoLimpo ? '#38e0d8' : '#f5b955'}
        right={
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => void recarregar()}>
            Reconferir
          </button>
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          Isto não é o relato do agente — é a leitura dos arquivos. O relato em prosa fica no{' '}
          <strong className="text-white/70">Painel</strong>, e diz o que ele acha que fez. Aqui está
          o que está mesmo em disco: quais arquivos existem, se o PDF é um PDF de verdade, o que há
          dentro do ZIP e se sobrou recado interno na entrega.
        </p>

        <div className="grid grid-cols-4 gap-3">
          {[
            { r: 'Atividades', v: totais.atividades },
            { r: 'Arquivos', v: totais.arquivos },
            { r: 'Pacotes', v: totais.zips },
            { r: 'A conferir', v: totais.suspeitas },
          ].map((c) => (
            <div key={c.r} className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
              <div
                className="text-2xl font-semibold"
                style={{
                  color: c.r === 'A conferir' && c.v > 0 ? '#f5b955' : 'rgba(255,255,255,0.9)',
                }}
              >
                {c.v}
              </div>
              <div className="text-[11px] text-white/35">{c.r}</div>
            </div>
          ))}
        </div>
      </Panel>

      {painel.atividades.length === 0 ? (
        <Panel>
          <EmptyState icon="📭">Nenhum entregável produzido ainda.</EmptyState>
        </Panel>
      ) : (
        painel.atividades.map((a) => <CartaoAtividade key={a.pasta} a={a} />)
      )}

      {painel.notas.length > 0 && (
        <Panel title="O que depende de você" icon="📌" accent="#8b7bff">
          <p className="mb-4 text-xs text-white/45">
            Escrito pelo agente e guardado <strong className="text-white/70">fora</strong> das pastas
            de entrega, em <span className="font-mono">_notas/</span>. Nada disso vai junto no ZIP.
          </p>
          <div className="flex flex-col gap-4">
            {painel.notas.map((n) => (
              <div key={n.atividade} className="rounded-xl border border-white/10 bg-black/25 p-4">
                <div className="mb-2 font-mono text-xs font-semibold text-accent-violet">
                  {n.atividade}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-white/65">
                  {n.conteudo}
                </pre>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
