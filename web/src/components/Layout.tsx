import type { ReactNode } from 'react';
import type { HealthInfo, ModoAutonomia } from '@shared/types';
import { CORES_MODO, ROTULO_MODO } from '../lib/modo';

export type Page = 'painel' | 'entrega' | 'cofre' | 'config';

export const PAGES: { id: Page; label: string; icon: string; subtitle: string }[] = [
  { id: 'painel', label: 'Painel', icon: '🎓', subtitle: 'Sessões, trilha ao vivo e aprovações' },
  { id: 'entrega', label: 'Entrega', icon: '📦', subtitle: 'O que a aplicação conferiu no disco' },
  { id: 'cofre', label: 'Cofre', icon: '🔒', subtitle: 'Credenciais cifradas pelo Windows' },
  { id: 'config', label: 'Configuração', icon: '⚙️', subtitle: 'Domínio, autonomia e navegador' },
];

function Indicador({ ok, texto, titulo }: { ok: boolean; texto: string; titulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/45" title={titulo}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-accent' : 'bg-accent-rose'} ${
          ok ? 'animate-pulse-soft' : ''
        }`}
      />
      {texto}
    </span>
  );
}

export function Layout({
  page,
  onNavigate,
  health,
  conectado,
  modo,
  rodando,
  children,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  health: HealthInfo | null;
  conectado: boolean;
  modo: ModoAutonomia;
  rodando: number;
  children: ReactNode;
}) {
  const meta = PAGES.find((p) => p.id === page)!;

  return (
    <div className="flex h-full">
      {/* Barra lateral */}
      <nav className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-ink-800/40 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-xl shadow-glow">
            🎓
          </span>
          <div>
            <div className="text-base font-semibold tracking-tight text-white">Diploma</div>
            <div className="text-[11px] text-white/40">copiloto de LMS</div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-3">
          {PAGES.map((p) => {
            const ativo = p.id === page;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onNavigate(p.id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  ativo
                    ? 'bg-accent/10 text-white shadow-[inset_2px_0_0_0_#38e0d8]'
                    : 'text-white/55 hover:bg-white/5 hover:text-white/85'
                }`}
              >
                <span className="text-base">{p.icon}</span>
                <span className="font-medium">{p.label}</span>
                {p.id === 'painel' && rodando > 0 && (
                  <span className="ml-auto rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
                    {rodando}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Rodapé: só dado real, nada inventado. */}
        <div className="flex flex-col gap-1.5 border-t border-white/5 px-5 py-4">
          <Indicador
            ok={conectado}
            texto={conectado ? 'ao vivo' : 'reconectando…'}
            titulo="Stream de eventos do servidor"
          />
          <Indicador
            ok={health?.auth === 'subscription' || health?.auth === 'apiKey'}
            texto={health?.auth === 'apiKey' ? 'API key' : 'assinatura Claude'}
            titulo="Origem da credencial da LLM, reportada pelo SDK"
          />
          <Indicador
            ok={Boolean(health?.cofre.disponivel)}
            texto={`cofre · ${health?.cofre.total ?? 0}`}
            titulo={health?.cofre.motivo ?? 'DPAPI do Windows disponível'}
          />
          <Indicador
            ok={Boolean(health?.navegador.instalado)}
            texto={
              health?.navegador.aberto
                ? 'navegador aberto'
                : health?.navegador.instalado
                  ? 'chromium pronto'
                  : 'chromium faltando'
            }
            titulo={
              health?.navegador.instalado
                ? 'Chromium do Playwright instalado'
                : 'Rode: npm run navegador'
            }
          />
        </div>
      </nav>

      {/* Conteúdo */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/5 px-8 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">{meta.label}</h1>
            <p className="text-xs text-white/40">{meta.subtitle}</p>
          </div>
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: `${CORES_MODO[modo]}1f`, color: CORES_MODO[modo] }}
            title="Modo de autonomia em vigor"
          >
            {ROTULO_MODO[modo]}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
