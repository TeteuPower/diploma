import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Raiz da aplicação.
 *
 * Em desenvolvimento, `server/env.ts` está um nível abaixo da raiz do repositório.
 * Instalado, o servidor é um bundle em `app/server.mjs`, também um nível abaixo
 * da pasta de instalação. A mesma conta serve para os dois — e é por isso que
 * o bundle tem que ficar exatamente em `app/`.
 */
export const PROJECT_ROOT = resolve(__dirname, '..');

/**
 * Instalado ou rodando do código-fonte? A diferença importa em duas coisas:
 * onde ficam os dados do dono e se o updater pode trocar os arquivos.
 *
 * O marcador é um arquivo que só o instalador coloca lá. Não é variável de
 * ambiente porque o atalho do Windows não consegue definir uma, e não é
 * heurística de caminho porque "está em Program Files?" erra para instalação
 * por usuário.
 */
export const INSTALADO = existsSync(join(PROJECT_ROOT, '.instalado'));

/**
 * Onde moram os dados do dono — cofre, sessões, perfil do navegador, trabalhos.
 *
 * Instalado, NUNCA dentro da pasta do app: ela é trocada inteira a cada
 * atualização e pode não ser gravável. Vai para %LOCALAPPDATA%\Diploma, que
 * sobrevive a update e a desinstalação (desinstalar não apaga o trabalho de
 * faculdade de ninguém). `DIPLOMA_HOME` permite apontar para outro lugar.
 */
const LOCALAPPDATA =
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? PROJECT_ROOT, 'AppData', 'Local');

export const HOME = process.env.DIPLOMA_HOME ?? (INSTALADO ? join(LOCALAPPDATA, 'Diploma') : PROJECT_ROOT);

export const DATA_DIR = join(HOME, 'data');
export const PERFIL_DIR = join(HOME, 'perfil-navegador');
export const TRABALHOS_DIR = join(HOME, 'trabalhos');

export const PATHS = {
  config: join(DATA_DIR, 'config.json'),
  sessoes: join(DATA_DIR, 'sessoes.json'),
  cofre: join(DATA_DIR, 'cofre.json'),
  tentativas: join(DATA_DIR, 'tentativas.json'),
  achados: join(DATA_DIR, 'achados.json'),
} as const;

export const WEB_DIST = join(PROJECT_ROOT, 'web', 'dist');

export const PORT = Number(process.env.DIPLOMA_PORT ?? 8980);

/**
 * A versão vem do package.json, e de nenhum outro lugar. O instalador recebe a
 * mesma do build.ps1, o nome do .exe carrega a mesma, e o updater compara com
 * esta. Uma fonte só, ou uma hora as três divergem.
 */
function lerVersao(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
export const VERSION = lerVersao();

/** Repositório de onde vêm as atualizações, quando a config não diz outro. */
export const REPOSITORIO_PADRAO = 'TeteuPower/diploma';

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
