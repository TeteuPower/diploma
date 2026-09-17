import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT } from './env';
import { classificar } from './comandos';
import { log, aviso, erro as logErro, cronometro } from './log';

/**
 * A camada de máquina: enxergar e agir no Windows, pelo mesmo modelo do
 * navegador — árvore de acessibilidade → refs → ações.
 *
 * O trabalho pesado está em `maquina.ps1`, porque a UI Automation mora no .NET
 * que já vem no Windows. Aqui fica o que é decisão de arquitetura:
 *
 * - **O script é chamado por `-File`, com argumentos separados.** Nunca
 *   montamos um comando por concatenação: nome de janela com aspas viraria
 *   injeção de PowerShell.
 * - **`executar` é o único ponto que roda comando arbitrário**, e ele não
 *   decide nada sozinho: quem classifica leitura × mudança é `comandos.ts`, e
 *   quem libera mudança é o portão, em `ferramentas.ts`.
 */

const SCRIPT = join(PROJECT_ROOT, 'server', 'maquina.ps1');

function rodarPs(args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true },
    );
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => {
      ps.kill();
      reject(new Error(`o script de máquina passou de ${timeoutMs} ms`));
    }, timeoutMs);

    ps.stdout.on('data', (d) => (saida += d.toString('utf8')));
    ps.stderr.on('data', (d) => (erro += d.toString('utf8')));
    ps.on('error', (e) => {
      clearTimeout(relogio);
      reject(new Error(`PowerShell não iniciou: ${e.message}`));
    });
    ps.on('close', (code) => {
      clearTimeout(relogio);
      if (code === 0) resolve(saida.trim());
      else reject(new Error(erro.trim().split('\n')[0] || `script saiu com ${code}`));
    });
  });
}

async function rodarJson<T>(args: string[], timeoutMs?: number): Promise<T> {
  const bruto = await rodarPs(args, timeoutMs);
  try {
    return JSON.parse(bruto) as T;
  } catch {
    throw new Error(`saída inesperada do script: ${bruto.slice(0, 200)}`);
  }
}

export interface Janela {
  pid: number;
  nome: string;
  tipo: string;
  classe: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export async function janelas(): Promise<Janela[]> {
  const r = await rodarJson<Janela | Janela[]>(['-Acao', 'janelas']);
  // Uma janela só volta como objeto, não array: é o ConvertTo-Json do PowerShell.
  return Array.isArray(r) ? r : [r];
}

export interface Arvore {
  pid: number;
  titulo: string;
  linhas: string;
  total: number;
  cortado: boolean;
}

export async function arvore(pid: number, maxLinhas = 250): Promise<string> {
  const medir = cronometro();
  const a = await rodarJson<Arvore>(['-Acao', 'arvore', '-Processo', String(pid), '-MaxLinhas', String(maxLinhas)], 45000);
  log('maquina', 'árvore coletada', {
    pid,
    titulo: a.titulo,
    linhas: a.total,
    cortado: a.cortado,
    ms: medir(),
  });
  // Guarda o nome de cada ref deste instantâneo, para conferir na hora de agir.
  for (const linha of a.linhas.split('\n')) {
    const m = /^\s*- \S+ "(.*?)" ref=(\d+:[\d.]+)/.exec(linha);
    if (m) nomesPorRef.set(m[2], m[1]);
  }

  const rodape = a.cortado
    ? `\n\n[cortado em ${maxLinhas} linhas — use maxLinhas maior, ou foque numa parte da janela]`
    : `\n\n[${a.total} elementos]`;
  return `Janela: ${a.titulo} (pid ${a.pid})\n\n${a.linhas}${rodape}`;
}

/**
 * O nome que cada ref tinha no último instantâneo, por janela.
 *
 * Serve para conferir antes de agir. O índice de irmão MUDA quando a árvore
 * muda: na Calculadora o botão "Um" saiu de `1.1.1.6.1` para `1.1.1.5.1` entre
 * duas leituras, e sem conferência o caminho antigo resolveria para outro botão
 * — clique errado, silencioso, com cara de sucesso. No navegador esse problema
 * não existe porque o ref é carimbado no próprio elemento; aqui o ref é um
 * caminho, então a conferência é o que faz as vezes do carimbo.
 *
 * Guardado no processo do servidor, que é longo — o PowerShell é que morre a
 * cada chamada. Só o último instantâneo de cada pid importa.
 */
const nomesPorRef = new Map<string, string>();

/** Ref no formato `pid:caminho` (ex.: `13340:1.0.0.2`). */
function partirRef(ref: string): { pid: string; caminho: string } {
  const m = /^(\d+):([\d.]*)$/.exec(ref.trim());
  if (!m) throw new Error(`ref inválido: "${ref}" (esperado algo como 13340:1.0.2)`);
  return { pid: m[1], caminho: m[2] };
}

/** Os argumentos de conferência, quando sabemos que nome esperar naquele ref. */
function esperado(ref: string): string[] {
  const nome = nomesPorRef.get(ref.trim());
  return nome ? ['-Esperado', nome] : [];
}

export async function clicar(ref: string): Promise<string> {
  const { pid, caminho } = partirRef(ref);
  const r = await rodarJson<{ via: string; alvo: string }>(
    ['-Acao', 'clicar', '-Processo', pid, '-Caminho', caminho, ...esperado(ref)],
  );
  log('maquina', 'clicou', { ref, via: r.via, alvo: r.alvo });
  return `cliquei em "${r.alvo}" (via ${r.via})`;
}

export async function escrever(ref: string, texto: string): Promise<string> {
  const { pid, caminho } = partirRef(ref);
  const r = await rodarJson<{ via: string }>(
    ['-Acao', 'escrever', '-Processo', pid, '-Caminho', caminho, '-Texto', texto, ...esperado(ref)],
  );
  log('maquina', 'escreveu', { ref, via: r.via, chars: texto.length });
  return `escrevi no campo (via ${r.via})`;
}

export async function alternar(ref: string): Promise<string> {
  const { pid, caminho } = partirRef(ref);
  const r = await rodarJson<{ antes: string; depois: string }>(
    ['-Acao', 'alternar', '-Processo', pid, '-Caminho', caminho, ...esperado(ref)],
  );
  log('maquina', 'alternou', { ref, antes: r.antes, depois: r.depois });
  return `alternei: ${r.antes} → ${r.depois}`;
}

export async function focar(pid: number): Promise<string> {
  const r = await rodarJson<{ titulo: string }>(['-Acao', 'focar', '-Processo', String(pid)]);
  return `foquei "${r.titulo}"`;
}

/** Captura da tela inteira, já reduzida e em JPEG base64. */
export async function captura(): Promise<{ base64: string; largura: number; altura: number }> {
  const medir = cronometro();
  const r = await rodarJson<{ base64: string; largura: number; altura: number }>(['-Acao', 'captura'], 45000);
  log('maquina', 'capturou a tela', { largura: r.largura, altura: r.altura, kb: Math.round(r.base64.length / 1365), ms: medir() });
  return r;
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

export interface ResultadoComando {
  ok: boolean;
  saida: string;
}

/**
 * Roda um comando PowerShell. **Não decide nada sobre permissão** — quem
 * classifica é `comandos.ts` e quem libera mudança é o portão. Aqui só executa
 * e devolve, com o comando indo por `-Command` num processo separado.
 */
export async function executar(comando: string, timeoutMs = 60000): Promise<ResultadoComando> {
  const medir = cronometro();
  const veredito = classificar(comando);

  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', comando],
      { windowsHide: true },
    );
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => {
      ps.kill();
      resolve({ ok: false, saida: `o comando passou de ${timeoutMs} ms e foi interrompido` });
    }, timeoutMs);

    ps.stdout.on('data', (d) => (saida += d.toString('utf8')));
    ps.stderr.on('data', (d) => (erro += d.toString('utf8')));
    ps.on('error', (e) => {
      clearTimeout(relogio);
      resolve({ ok: false, saida: `PowerShell não iniciou: ${e.message}` });
    });
    ps.on('close', (code) => {
      clearTimeout(relogio);
      const texto = [saida.trim(), erro.trim()].filter(Boolean).join('\n').slice(0, 8000);
      log('maquina', 'comando', {
        leitura: veredito.leitura,
        codigo: code,
        comando: comando.slice(0, 160),
        ms: medir(),
      });
      resolve({ ok: code === 0, saida: texto || '(sem saída)' });
    });
  });
}

/** O Windows tem UI Automation disponível? Uma chamada barata para a saúde. */
export async function disponivel(): Promise<{ ok: boolean; motivo: string | null }> {
  if (process.platform !== 'win32') return { ok: false, motivo: 'a camada de máquina é do Windows' };
  try {
    await janelas();
    return { ok: true, motivo: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    aviso('maquina', 'indisponível', { motivo: m });
    return { ok: false, motivo: m };
  }
}

// ---------------------------------------------------------------------------
// Primitivas de desktop: abrir, teclar, esperar, área de transferência
// ---------------------------------------------------------------------------

/**
 * Abre um programa. `Start-Process` resolve caminho completo, nome no PATH e o
 * App Paths do registro — então tanto `notepad` quanto o `.exe` inteiro valem.
 * Devolve o pid, que é por onde `arvore()` enxerga a janela depois.
 */
export async function abrirPrograma(programa: string, argumentos = ''): Promise<{ pid: number; nome: string }> {
  const args = ['-Acao', 'abrir', '-Programa', programa];
  if (argumentos) args.push('-Argumentos', argumentos);
  const r = await rodarJson<{ processo: number; nome: string }>(args, 30000);
  log('maquina', 'abriu programa', { programa, argumentos, pid: r.processo, nome: r.nome });
  return { pid: r.processo, nome: r.nome };
}

/**
 * Teclado. `atalho` é uma combinação legível ("win+r", "ctrl+shift+esc",
 * "alt+f4") e vai por `keybd_event`, que alcança a tecla Windows — o SendKeys
 * não alcança. `texto` é digitação literal.
 */
export async function teclado(atalho = '', texto = ''): Promise<string> {
  if (!atalho && !texto) throw new Error('teclado precisa de atalho ou texto');
  const args = ['-Acao', 'teclado'];
  if (atalho) args.push('-Atalho', atalho);
  if (texto) args.push('-Texto', texto);
  await rodarJson(args, 30000);
  log('maquina', 'teclado', { atalho, chars: texto.length });
  return [atalho && `atalho ${atalho}`, texto && `digitei ${texto.length} caractere(s)`].filter(Boolean).join(' + ');
}

/** Espera uma janela cujo título contenha o texto. Programa recém-aberto demora a existir na UIA. */
export async function esperarJanela(titulo: string, segundos = 15): Promise<{ achou: boolean; pid?: number; nome?: string }> {
  const r = await rodarJson<{ achou: boolean; processo?: number; nome?: string }>(
    ['-Acao', 'esperar', '-Texto', titulo, '-Segundos', String(segundos)],
    (segundos + 10) * 1000,
  );
  log('maquina', 'esperou janela', { titulo, achou: r.achou, pid: r.processo });
  return { achou: r.achou, pid: r.processo, nome: r.nome };
}

export async function lerTransferencia(): Promise<string> {
  const r = await rodarJson<{ texto: string }>(['-Acao', 'ler-transferencia']);
  return r.texto;
}

export async function escreverTransferencia(texto: string): Promise<string> {
  await rodarJson(['-Acao', 'escrever-transferencia', '-Texto', texto]);
  return `área de transferência com ${texto.length} caractere(s)`;
}
