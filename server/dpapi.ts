import { spawn } from 'node:child_process';
import { COFRE_ENTROPIA } from './env';

/**
 * DPAPI do Windows via PowerShell.
 *
 * Por que PowerShell e não um módulo nativo: DPAPI não tem binding em Node sem
 * node-gyp, e um .node compilado é uma dependência frágil de instalar. A API
 * ProtectedData já vem no .NET que acompanha o Windows, então chamar por ali
 * custa ~200 ms e zero dependência. O cofre é lido no login, não em loop — esse
 * custo não aparece.
 *
 * O SEGREDO VAI POR STDIN, nunca por argumento: argumento de processo é visível
 * na lista de processos da máquina inteira. Só o script (que não é secreto) vai
 * em -EncodedCommand.
 */

const PS = 'powershell.exe';

function encodar(script: string): string {
  // -EncodedCommand espera UTF-16LE em base64.
  return Buffer.from(script, 'utf16le').toString('base64');
}

function rodar(script: string, entrada: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodar(script)], {
      windowsHide: true,
    });

    let saida = '';
    let erro = '';
    ps.stdout.on('data', (d) => (saida += d.toString('utf8')));
    ps.stderr.on('data', (d) => (erro += d.toString('utf8')));

    ps.on('error', (err) => reject(new Error(`PowerShell não pôde ser iniciado: ${err.message}`)));
    ps.on('close', (code) => {
      if (code === 0) resolve(saida.trim());
      else reject(new Error(erro.trim() || `PowerShell saiu com código ${code}`));
    });

    ps.stdin.write(entrada, 'utf8');
    ps.stdin.end();
  });
}

const PROTEGER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$ent   = [Text.Encoding]::UTF8.GetBytes('${COFRE_ENTROPIA}')
$prot  = [Security.Cryptography.ProtectedData]::Protect($bytes, $ent, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($prot))
`;

const DESPROTEGER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b64   = [Console]::In.ReadToEnd()
$prot  = [Convert]::FromBase64String($b64.Trim())
$ent   = [Text.Encoding]::UTF8.GetBytes('${COFRE_ENTROPIA}')
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($prot, $ent, 'CurrentUser')
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

/** Cifra com a chave da conta do Windows logada. Devolve base64. */
export async function proteger(texto: string): Promise<string> {
  return rodar(PROTEGER, texto);
}

/** Decifra. Só funciona na mesma conta de Windows que cifrou. */
export async function desproteger(base64: string): Promise<string> {
  return rodar(DESPROTEGER, base64);
}

/** Checa se o DPAPI responde nesta máquina (Windows + PowerShell disponíveis). */
export async function dpapiDisponivel(): Promise<{ ok: boolean; motivo: string | null }> {
  if (process.platform !== 'win32') {
    return { ok: false, motivo: 'DPAPI só existe no Windows.' };
  }
  try {
    const prova = await proteger('diploma-prova');
    const volta = await desproteger(prova);
    if (volta !== 'diploma-prova') {
      return { ok: false, motivo: 'DPAPI respondeu, mas o texto não bateu na volta.' };
    }
    return { ok: true, motivo: null };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}
