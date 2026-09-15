import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolverCaminho } from './trabalhos';
import { log, cronometro } from './log';

/**
 * ZIP pelo `Compress-Archive` do PowerShell.
 *
 * Entrega de projeto quase sempre é um ZIP com nome exigido (`GRUPO_XX.zip`),
 * e sem isso o agente para a um passo do fim. Mesma escolha do cofre: o Windows
 * já traz a ferramenta, e uma biblioteca de compressão seria dependência nova
 * para algo que a máquina faz sozinha.
 *
 * O caminho passa por `resolverCaminho`, então origem e destino continuam
 * presos a `trabalhos/` — compactar não é uma porta dos fundos para ler o disco.
 */
export async function compactar(
  pastaRelativa: string,
  zipRelativo: string,
): Promise<{ bytes: number }> {
  const origem = resolverCaminho(pastaRelativa);
  const destino = resolverCaminho(zipRelativo);
  if (!zipRelativo.toLowerCase().endsWith('.zip')) {
    throw new Error(`o destino precisa terminar em .zip: "${zipRelativo}"`);
  }

  const medir = cronometro();

  // Os caminhos vão por variável, com aspas simples e escape de aspas simples:
  // interpolar direto no comando deixaria um nome de pasta com aspas quebrar a
  // linha inteira. `-Force` sobrescreve um ZIP de uma rodada anterior.
  const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = `
$ErrorActionPreference = 'Stop'
$origem  = ${aspas(origem)}
$destino = ${aspas(destino)}
if (-not (Test-Path -LiteralPath $origem)) { throw "pasta nao encontrada: $origem" }
Compress-Archive -Path (Join-Path $origem '*') -DestinationPath $destino -Force
`;

  await new Promise<void>((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true },
    );
    let erro = '';
    ps.stderr.on('data', (d) => (erro += d.toString('utf8')));
    ps.on('error', (e) => reject(new Error(`PowerShell não iniciou: ${e.message}`)));
    ps.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(erro.trim() || `Compress-Archive saiu com ${code}`)),
    );
  });

  const bytes = statSync(destino).size;
  log('compactar', 'zip gerado', { de: pastaRelativa, para: zipRelativo, bytes, ms: medir() });
  return { bytes };
}
