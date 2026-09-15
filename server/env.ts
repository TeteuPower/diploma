import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(__dirname, '..');

/** Dados locais (JSON + cofre cifrado). Gitignored. */
export const DATA_DIR = join(PROJECT_ROOT, 'data');

/** Perfil do Chromium — cookies/sessão do LMS sobrevivem entre execuções. */
export const PERFIL_DIR = join(PROJECT_ROOT, 'perfil-navegador');

export const PATHS = {
  config: join(DATA_DIR, 'config.json'),
  sessoes: join(DATA_DIR, 'sessoes.json'),
  cofre: join(DATA_DIR, 'cofre.json'),
} as const;

export const WEB_DIST = join(PROJECT_ROOT, 'web', 'dist');

export const PORT = Number(process.env.DIPLOMA_PORT ?? 8980);

export const VERSION = '1.0.0';

/**
 * Entropia adicional do DPAPI. Não é uma senha (o segredo real é a chave da
 * conta do Windows): serve para que um blob deste app não possa ser decifrado
 * por outro programa seu que só chame Unprotect no escopo CurrentUser.
 */
export const COFRE_ENTROPIA = 'diploma/cofre/v1';

/**
 * Trava-mestre de autonomia. Com DIPLOMA_MODO=observar na env, a config da UI
 * é ignorada e o agente roda só lendo — independentemente do que estiver salvo.
 */
export function modoTravadoPorEnv(): boolean {
  return process.env.DIPLOMA_MODO === 'observar';
}

/** Sem ANTHROPIC_API_KEY o SDK usa a credencial da assinatura do Claude Code. */
export function hasApiKeyEnv(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}
