import { useCallback, useEffect, useState } from 'react';
import type { DiplomaConfig, EstadoCofre, HealthInfo, Sessao } from '@shared/types';
import { Layout, PAGES, type Page } from './components/Layout';
import { Painel } from './pages/Painel';
import { Entrega } from './pages/Entrega';
import { Cofre } from './pages/Cofre';
import { Config } from './pages/Config';
import { getConfig, getCofre, getHealth, getSessoes, abrirStream } from './api';

const VALIDAS: Page[] = PAGES.map((p) => p.id);

function lerPagina(): Page {
  const bruto = window.location.hash.replace(/^#\/?/, '') as Page;
  return VALIDAS.includes(bruto) ? bruto : 'painel';
}

export function App() {
  const [page, setPage] = useState<Page>(lerPagina());
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [config, setConfig] = useState<DiplomaConfig | null>(null);
  const [cofre, setCofre] = useState<EstadoCofre | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [conectado, setConectado] = useState(false);

  const recarregarConfig = useCallback(async () => {
    try {
      setConfig(await getConfig());
    } catch {
      /* ignora */
    }
  }, []);

  const recarregarCofre = useCallback(async () => {
    try {
      setCofre(await getCofre());
    } catch {
      /* ignora */
    }
  }, []);

  const recarregarSaude = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      /* ignora */
    }
  }, []);

  const recarregarSessoes = useCallback(async () => {
    try {
      setSessoes(await getSessoes());
    } catch {
      /* ignora */
    }
  }, []);

  // O stream é a fonte de verdade das sessões: o servidor empurra cada mudança
  // e a UI nunca reenvia o estado inteiro de volta.
  useEffect(() => {
    const fechar = abrirStream((e) => {
      if (e.type === 'snapshot') setSessoes(e.sessoes);
      else if (e.type === 'sessao') {
        setSessoes((atual) => {
          const i = atual.findIndex((s) => s.id === e.sessao.id);
          if (i === -1) return [e.sessao, ...atual];
          const copia = [...atual];
          copia[i] = e.sessao;
          return copia;
        });
      } else if (e.type === 'removida') {
        setSessoes((atual) => atual.filter((s) => s.id !== e.id));
      }
    }, setConectado);
    return fechar;
  }, []);

  useEffect(() => {
    void recarregarConfig();
    void recarregarCofre();
    void recarregarSaude();
    void recarregarSessoes();

    const onHash = () => setPage(lerPagina());
    window.addEventListener('hashchange', onHash);
    // Saúde é dado real e leve (auth, cofre, chromium) — vale reconferir.
    const t = setInterval(() => void recarregarSaude(), 15000);
    return () => {
      window.removeEventListener('hashchange', onHash);
      clearInterval(t);
    };
  }, [recarregarConfig, recarregarCofre, recarregarSaude, recarregarSessoes]);

  const navegar = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
  };

  const rodando = sessoes.filter(
    (s) => s.status === 'rodando' || s.status === 'aguardando',
  ).length;

  // O domínio do alvo, para o cofre sugerir sozinho na hora de cadastrar.
  const dominioAlvo = (() => {
    const base = config?.alvo.urlBase?.trim();
    if (!base) return '';
    try {
      return new URL(base.includes('://') ? base : `https://${base}`).host;
    } catch {
      return base;
    }
  })();

  return (
    <Layout
      page={page}
      onNavigate={navegar}
      health={health}
      conectado={conectado}
      modo={config?.modo ?? 'assistido'}
      rodando={rodando}
    >
      {page === 'painel' && (
        <Painel sessoes={sessoes} config={config} onMudou={recarregarSessoes} />
      )}
      {page === 'entrega' && <Entrega />}
      {page === 'cofre' && (
        <Cofre
          estado={cofre}
          dominioSugerido={dominioAlvo}
          onMudou={() => {
            void recarregarCofre();
            void recarregarSaude();
          }}
        />
      )}
      {page === 'config' && <Config config={config} onMudou={recarregarConfig} />}
    </Layout>
  );
}
