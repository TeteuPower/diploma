/**
 * Ler é livre; mudar pede aprovação. Esta função é quem decide de que lado
 * um comando cai — e é a peça mais perigosa do módulo de máquina.
 *
 * O risco é **assimétrico**, e a régua sai disso: classificar leitura como
 * mudança custa uma aprovação a mais ao dono; classificar mudança como leitura
 * muda a máquina dele em silêncio. Então isto é uma **allowlist**: o comando só
 * é leitura se cada pedaço dele for comprovadamente leitura. Qualquer coisa
 * fora da lista, qualquer construção que possa esconder outra coisa, e
 * qualquer dúvida — vira mudança, e a mudança passa pelo portão.
 *
 * Não é um parser de PowerShell, e não tenta ser: é um porteiro conservador.
 */

/** Verbos que só leem. `Show-` ficou de fora: abre janela, mexe na tela. */
const CMDLETS_LEITURA = new Set([
  // consulta
  'get-process', 'get-service', 'get-item', 'get-childitem', 'get-content',
  'get-itemproperty', 'get-itempropertyvalue', 'get-computerinfo', 'get-date',
  'get-host', 'get-location', 'get-member', 'get-command', 'get-help',
  'get-hotfix', 'get-package', 'get-volume', 'get-disk', 'get-partition',
  'get-netadapter', 'get-netipaddress', 'get-netipconfiguration', 'get-dnsclientserveraddress',
  'get-wmiobject', 'get-ciminstance', 'get-eventlog', 'get-winevent',
  'get-scheduledtask', 'get-scheduledtaskinfo', 'get-localuser', 'get-localgroup',
  'get-psdrive', 'get-variable', 'get-random', 'get-filehash', 'get-acl',
  'get-clipboard', 'get-timezone', 'get-culture', 'get-uiculture',
  'get-appxpackage', 'get-startapps', 'get-pnpdevice', 'get-printer',
  'get-physicaldisk', 'get-netroute', 'get-nettcpconnection', 'get-smbshare',
  // teste e medida
  'test-path', 'test-connection', 'test-netconnection', 'measure-object', 'measure-command',
  'resolve-path', 'compare-object',
  // moldar a saída (não tocam em nada)
  'select-object', 'select-string', 'where-object', 'sort-object', 'group-object',
  'foreach-object', 'format-list', 'format-table', 'format-wide', 'out-string',
  'convertto-json', 'convertfrom-json', 'convertto-csv', 'convertfrom-csv',
  'write-output', 'write-host', 'tee-object',
]);

/** Aliases comuns que caem nos cmdlets acima. */
const ALIASES_LEITURA = new Map<string, string>([
  ['ls', 'get-childitem'], ['dir', 'get-childitem'], ['gci', 'get-childitem'],
  ['cat', 'get-content'], ['gc', 'get-content'], ['type', 'get-content'],
  ['ps', 'get-process'], ['gps', 'get-process'], ['gsv', 'get-service'],
  ['gi', 'get-item'], ['gp', 'get-itemproperty'], ['gm', 'get-member'],
  ['gcm', 'get-command'], ['pwd', 'get-location'], ['gl', 'get-location'],
  ['select', 'select-object'], ['where', 'where-object'], ['?', 'where-object'],
  ['sort', 'sort-object'], ['group', 'group-object'], ['%', 'foreach-object'],
  ['fl', 'format-list'], ['ft', 'format-table'], ['echo', 'write-output'],
  ['measure', 'measure-object'], ['sls', 'select-string'], ['tee', 'tee-object'],
]);

/**
 * Construções que derrubam a classificação para "mudança" sem nem olhar o
 * resto. Cada uma pode esconder um comando inteiro dentro de si — e um
 * porteiro que não entende o que está lendo tem de dizer não.
 */
const PROIBIDO_NA_LEITURA: Array<[RegExp, string]> = [
  [/[;&]/, 'encadeamento (; ou &) pode esconder outro comando'],
  [/\|\s*\|/, 'operador || '],
  [/>/, 'redirecionamento grava arquivo'],
  [/\biex\b|\binvoke-expression\b/i, 'Invoke-Expression executa texto arbitrário'],
  [/\binvoke-command\b|\bicm\b/i, 'Invoke-Command executa em outro escopo'],
  [/\bstart-process\b|\bsaps\b/i, 'Start-Process abre programa'],
  [/\bnew-object\b/i, 'New-Object alcança .NET inteiro'],
  [/\badd-type\b/i, 'Add-Type compila e carrega código'],
  [/\[\s*[a-z.]+\s*\]\s*::/i, 'chamada estática de .NET'],
  // `Get-Process | ForEach-Object { $_.Kill() }` passava: o cmdlet está na
  // allowlist e a mudança mora no MÉTODO dentro do bloco. Invocação de método
  // derruba a classificação — parêntese é o que separa `$_.Kill()` de
  // `$_.Status`, que é leitura de propriedade e continua valendo.
  [/\.\s*\w+\s*\(/, 'invocação de método pode fazer qualquer coisa'],
  [/\$\(/, 'subexpressão $( ) pode conter outro comando'],
  [/`/, 'crase escapa caractere e confunde a leitura'],
  [/\bcmd(\.exe)?\b|\bpowershell(\.exe)?\b|\bpwsh\b/i, 'shell aninhado'],
  [/\breg(\.exe)?\s|\bpowercfg\b|\bnetsh\b|\bsc(\.exe)?\s|\btaskkill\b|\bschtasks\b|\bwmic\b|\bbcdedit\b|\bdiskpart\b/i,
    'executável nativo que altera o sistema'],
  [/\bremove-|\bset-|\bnew-|\bstart-|\bstop-|\brestart-|\badd-|\bclear-|\bdisable-|\benable-|\binstall-|\buninstall-|\brename-|\bmove-|\bcopy-|\bexport-|\bimport-|\bregister-|\bunregister-|\bsuspend-|\bresume-|\bout-file\b/i,
    'verbo que altera estado'],
];

export interface Veredito {
  leitura: boolean;
  /** Por que não é leitura. Vazio quando é. */
  motivo: string;
}

/**
 * O comando é comprovadamente só-leitura?
 *
 * Quebra por `|` e exige que CADA segmento comece com um cmdlet da allowlist.
 * Segmento que começa com variável, parêntese ou qualquer outra coisa não é
 * reconhecido — e o que não é reconhecido não passa.
 */
export function classificar(comando: string): Veredito {
  const cmd = comando.trim();
  if (!cmd) return { leitura: false, motivo: 'comando vazio' };
  if (cmd.length > 2000) return { leitura: false, motivo: 'comando longo demais para ser conferido' };

  for (const [re, motivo] of PROIBIDO_NA_LEITURA) {
    if (re.test(cmd)) return { leitura: false, motivo };
  }

  // Quebra por pipe. O `|` dentro de aspas escaparia desta conta — por isso
  // aspas com pipe dentro já são tratadas como suspeitas logo abaixo.
  const segmentos = cmd.split('|').map((s) => s.trim()).filter(Boolean);
  if (!segmentos.length) return { leitura: false, motivo: 'comando vazio' };

  for (const seg of segmentos) {
    const primeiro = (seg.split(/\s+/)[0] ?? '').toLowerCase().replace(/^&\s*/, '');
    const nome = ALIASES_LEITURA.get(primeiro) ?? primeiro;
    if (!CMDLETS_LEITURA.has(nome)) {
      return { leitura: false, motivo: `"${primeiro || seg}" não está na lista de comandos de leitura` };
    }
  }

  return { leitura: true, motivo: '' };
}
