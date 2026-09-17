import type {
  DiplomaConfig,
  EstadoCofre,
  CredencialMeta,
  Sessao,
  HealthInfo,
  SessaoStreamEvent,
  PainelEntrega,
  TipoMissao,
  PoliticaDominio,
  Achado,
} from '@shared/types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(detalhe || `${res.status} ${url}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Config ---
export const getConfig = () => jsonFetch<DiplomaConfig>('/api/config');
export const patchConfig = (patch: Partial<DiplomaConfig>) =>
  jsonFetch<DiplomaConfig>('/api/config', { method: 'PATCH', body: JSON.stringify(patch) });

// --- Cofre (metadados; a senha só sobe, nunca desce) ---
export const getCofre = () => jsonFetch<EstadoCofre>('/api/cofre');
export const guardarCredencial = (input: {
  dominio: string;
  usuario: string;
  senha: string;
  rotulo?: string;
}) => jsonFetch<CredencialMeta>('/api/cofre', { method: 'POST', body: JSON.stringify(input) });
export const removerCredencial = (id: string) =>
  jsonFetch<void>(`/api/cofre/${id}`, { method: 'DELETE' });

// --- Sessões ---
export const getSessoes = () => jsonFetch<Sessao[]>('/api/sessoes');
export const criarSessao = (
  objetivo: string,
  missao: TipoMissao = 'lms',
  dominios?: Partial<PoliticaDominio>,
) =>
  jsonFetch<Sessao>('/api/sessoes', {
    method: 'POST',
    body: JSON.stringify({ objetivo, missao, dominios }),
  });
export const retomarSessao = (id: string) =>
  jsonFetch<{ ok: boolean }>(`/api/sessoes/${id}/retomar`, { method: 'POST' });
export const pararSessao = (id: string) =>
  jsonFetch<{ ok: boolean }>(`/api/sessoes/${id}/parar`, { method: 'POST' });
export const removerSessao = (id: string) =>
  jsonFetch<void>(`/api/sessoes/${id}`, { method: 'DELETE' });
export const responderAprovacao = (
  sessaoId: string,
  pedidoId: string,
  aprovado: boolean,
  motivo = '',
) =>
  jsonFetch<{ ok: boolean }>(`/api/sessoes/${sessaoId}/aprovacao`, {
    method: 'POST',
    body: JSON.stringify({ pedidoId, aprovado, motivo }),
  });
export const fecharNavegador = () =>
  jsonFetch<{ ok: boolean }>('/api/sessoes/navegador/fechar', { method: 'POST' });

// --- Achados (o que ele encontrou, com fonte) ---
export const getAchados = (sessao?: string) =>
  jsonFetch<Achado[]>(`/api/achados${sessao ? `?sessao=${encodeURIComponent(sessao)}` : ''}`);
export const removerAchado = (id: string) =>
  jsonFetch<void>(`/api/achados/${id}`, { method: 'DELETE' });

// --- Brave Search (a chave vai para o cofre; nunca desce) ---
export const getBrave = () => jsonFetch<{ configurada: boolean; pais: string }>('/api/brave');
export const salvarChaveBrave = (chave: string) =>
  jsonFetch<{ configurada: boolean }>('/api/brave/chave', {
    method: 'POST',
    body: JSON.stringify({ chave }),
  });
export const removerChaveBrave = () => jsonFetch<void>('/api/brave/chave', { method: 'DELETE' });
export const testarBrave = () =>
  jsonFetch<{ ok: boolean; detalhe: string; amostra: { titulo: string; url: string }[] }>(
    '/api/brave/testar',
    { method: 'POST' },
  );

// --- Entrega (conferido no disco, não relatado pelo agente) ---
export const getEntrega = () => jsonFetch<PainelEntrega>('/api/entrega');

// --- Saúde ---
export const getHealth = () => jsonFetch<HealthInfo>('/api/health');

/** Stream ao vivo das sessões. Devolve um "fechar". */
export function abrirStream(
  onEvent: (e: SessaoStreamEvent) => void,
  onStatus?: (conectado: boolean) => void,
): () => void {
  const es = new EventSource('/api/sessoes/stream');
  es.onopen = () => onStatus?.(true);
  es.onmessage = (m) => {
    onStatus?.(true);
    try {
      onEvent(JSON.parse(m.data) as SessaoStreamEvent);
    } catch {
      /* ignora frame malformado */
    }
  };
  // O EventSource reconecta sozinho em erro de rede.
  es.onerror = () => onStatus?.(false);
  return () => es.close();
}
