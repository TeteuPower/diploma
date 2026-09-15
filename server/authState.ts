import type { HealthInfo } from '../shared/types';
import { hasApiKeyEnv } from './env';

/**
 * Origem de credencial REAL, reportada pelo SDK na mensagem de init de cada
 * query (apiKeySource). Antes da primeira query, caímos numa heurística por env.
 * Mesmo padrão do Jarvis — a UI usa isso para dizer ao dono se ele está na
 * assinatura do Claude Code ou numa API key.
 */
let ultimaOrigem: string | null = null;

export function registrarOrigem(origem: string | undefined | null): void {
  if (origem) ultimaOrigem = origem;
}

export function resolverAuth(): HealthInfo['auth'] {
  const s = (ultimaOrigem ?? '').toLowerCase();
  if (s) {
    if (s.includes('api') && s.includes('key')) return 'apiKey';
    if (s === 'none') return hasApiKeyEnv() ? 'apiKey' : 'subscription';
    // Qualquer outra origem (login/oauth) é a assinatura do Claude Code.
    return 'subscription';
  }
  return hasApiKeyEnv() ? 'apiKey' : 'subscription';
}
