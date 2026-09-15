import { useEffect, useRef, useState } from 'react';
import type { Sessao, DiplomaConfig } from '@shared/types';
import { Panel, TextArea, EmptyState, Badge } from '../components/ui';
import {
  ICONE_PASSO, COR_PASSO, COR_STATUS, ROTULO_STATUS,
  ROTULO_ACAO, CORES_MODO, ROTULO_MODO, hora, dataHora,
} from '../lib/modo';
import {
  criarSessao, pararSessao, retomarSessao, removerSessao, responderAprovacao,
} from '../api';

/**
 * O cartão de aprovação. É a peça mais importante da tela: enquanto ele está
 * aberto, uma ferramenta do agente está literalmente bloqueada esperando o
 * clique. Por isso o `detalhe` aparece inteiro e sem corte — é o que a pessoa
 * lê antes de deixar uma submissão irreversível acontecer.
 */
function Aprovacao({ sessao }: { sessao: Sessao }) {
  const [enviando, setEnviando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const p = sessao.pendente;
  if (!p) return null;

  const responder = async (aprovado: boolean) => {
    setEnviando(true);
    try {
      await responderAprovacao(sessao.id, p.id, aprovado, motivo);
      setMotivo('');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="animate-fade-in rounded-2xl border border-accent-amber/40 bg-accent-amber/[0.07] p-5 shadow-glow-amber">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">⏸️</span>
        <h3 className="text-sm font-semibold text-accent-amber">
          O agente está parado esperando você
        </h3>
        <Badge color="#f5b955">{ROTULO_ACAO[p.acao] ?? p.acao}</Badge>
      </div>

      <p className="mb-3 text-sm text-white/85">{p.descricao}</p>

      <div className="mb-3">
        <div className="label">O que exatamente vai acontecer</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed text-white/75">
          {p.detalhe || '(o agente não detalhou)'}
        </pre>
      </div>

      {p.url && (
        <p className="mb-3 truncate font-mono text-[11px] text-white/35" title={p.url}>
          {p.url}
        </p>
      )}

      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Observação (opcional) — vai junto para o agente"
        className="glass-input mb-3 w-full"
      />

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ok"
          disabled={enviando}
          onClick={() => void responder(true)}
        >
          Aprovar e seguir
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={enviando}
          onClick={() => void responder(false)}
        >
          Recusar
        </button>
      </div>
    </div>
  );
}

/** A trilha. Rola sozinha enquanto o dono está no fim — se ele subiu para ler, não. */
function Trilha({ sessao }: { sessao: Sessao }) {
  const ref = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [sessao.passos.length]);

  const aoRolar = () => {
    const el = ref.current;
    if (!el) return;
    colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  if (!sessao.passos.length) {
    return <EmptyState icon="🌱">A sessão ainda não deu o primeiro passo.</EmptyState>;
  }

  return (
    <div ref={ref} onScroll={aoRolar} className="max-h-[380px] overflow-y-auto pr-1">
      <ul className="flex flex-col gap-0.5">
        {sessao.passos.map((passo) => (
          <li key={passo.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <span className="mt-[1px] shrink-0 text-xs" title={passo.tipo}>
              {ICONE_PASSO[passo.tipo]}
            </span>
            <span className="shrink-0 font-mono text-[10px] leading-5 text-white/25">
              {hora(passo.at)}
            </span>
            <span
              className="min-w-0 flex-1 break-words text-xs leading-5"
              style={{ color: COR_PASSO[passo.tipo] }}
            >
              {passo.resumo}
              {passo.ferramenta && (
                <span className="ml-1.5 font-mono text-[10px] text-white/20">
                  {passo.ferramenta}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartaoSessao({ sessao, onMudou }: { sessao: Sessao; onMudou: () => void }) {
  const [aberta, setAberta] = useState(sessao.status === 'rodando' || sessao.status === 'aguardando');
  const ativa = sessao.status === 'rodando' || sessao.status === 'aguardando';
  const cor = COR_STATUS[sessao.status];

  const acao = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onMudou();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="glass overflow-hidden">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-white/[0.02]"
      >
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ativa ? 'animate-pulse-soft' : ''}`}
          style={{ background: cor, boxShadow: ativa ? `0 0 10px ${cor}` : undefined }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">{sessao.objetivo}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
            <span style={{ color: cor }}>{ROTULO_STATUS[sessao.status]}</span>
            <span>·</span>
            <span style={{ color: CORES_MODO[sessao.modo] }}>{ROTULO_MODO[sessao.modo]}</span>
            <span>·</span>
            <span>{sessao.passos.length} passos</span>
            <span>·</span>
            <span>{dataHora(sessao.criadaEm)}</span>
          </div>
        </div>
        <span className="shrink-0 text-xs text-white/25">{aberta ? '▲' : '▼'}</span>
      </button>

      {aberta && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3">
          {sessao.pendente && (
            <div className="mb-4">
              <Aprovacao sessao={sessao} />
            </div>
          )}

          {/* A instrução inteira, sem corte. No cabeçalho ela é truncada para o
              cartão caber; se não aparecesse em lugar nenhum, o dono perderia o
              que ele mesmo pediu — e foi exatamente o que aconteceu. */}
          <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="label">Instrução dada</div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/70">
              {sessao.objetivo}
            </p>
          </div>

          {sessao.urlAtual && (
            <p className="mb-3 truncate font-mono text-[11px] text-white/30" title={sessao.urlAtual}>
              📍 {sessao.urlAtual}
            </p>
          )}

          <Trilha sessao={sessao} />

          {sessao.resultado && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
              <div className="label">Relato final</div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/70">
                {sessao.resultado}
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {ativa ? (
              <button
                type="button"
                className="btn-danger"
                onClick={() => void acao(() => pararSessao(sessao.id))}
              >
                Parar
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void acao(() => retomarSessao(sessao.id))}
                title="Continua de onde parou, reaproveitando o contexto da sessão"
              >
                Retomar
              </button>
            )}
            <button
              type="button"
              className="btn-ghost ml-auto"
              onClick={() => {
                if (confirm('Apagar esta sessão e sua trilha?')) {
                  void acao(() => removerSessao(sessao.id));
                }
              }}
            >
              Apagar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Painel({
  sessoes,
  config,
  onMudou,
}: {
  sessoes: Sessao[];
  config: DiplomaConfig | null;
  onMudou: () => void;
}) {
  const [objetivo, setObjetivo] = useState('');
  const [criando, setCriando] = useState(false);

  const semDominio = !config?.alvo.urlBase?.trim();

  const iniciar = async () => {
    if (!objetivo.trim() || criando) return;
    setCriando(true);
    try {
      await criarSessao(objetivo.trim());
      setObjetivo('');
      onMudou();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Panel title="Nova sessão" icon="▶️" accent="#38e0d8">
        {semDominio ? (
          <EmptyState icon="🧭">
            Nenhum domínio apontado ainda. Vá em <strong>Configuração</strong> e diga a que LMS
            este copiloto responde.
          </EmptyState>
        ) : (
          <>
            <TextArea
              rows={3}
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              placeholder={'Ex.: Entrar no curso "Segurança da Informação", abrir o módulo 3 e responder o questionário de fixação.'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void iniciar();
              }}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-white/35">
                Alvo: <span className="font-mono text-white/50">{config?.alvo.urlBase}</span>
                {' · '}Ctrl+Enter para iniciar
              </p>
              <button
                type="button"
                className="btn-primary"
                disabled={!objetivo.trim() || criando}
                onClick={() => void iniciar()}
              >
                {criando ? 'Iniciando…' : 'Iniciar sessão'}
              </button>
            </div>
          </>
        )}
      </Panel>

      {sessoes.length === 0 ? (
        <Panel>
          <EmptyState icon="🗂️">Nenhuma sessão ainda.</EmptyState>
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {sessoes.map((s) => (
            <CartaoSessao key={s.id} sessao={s} onMudou={onMudou} />
          ))}
        </div>
      )}
    </div>
  );
}
