/**
 * A classificação de comandos decide o que roda sem perguntar na máquina do
 * dono. Falso positivo (leitura virar mudança) custa uma aprovação; falso
 * negativo muda o PC dele em silêncio. Então o teste cobre principalmente o
 * segundo caso: tudo que tenta se disfarçar de leitura.
 */
import { classificar } from '../server/comandos';

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

const leitura = (cmd: string) => {
  const v = classificar(cmd);
  checa(`LEITURA: ${cmd}`, v.leitura, v.motivo);
};
const mudanca = (cmd: string, porque = '') => {
  const v = classificar(cmd);
  checa(`mudança: ${cmd}`, !v.leitura, v.leitura ? 'PASSOU COMO LEITURA — perigoso' : porque || v.motivo);
};

console.log('Leitura legítima (tem que passar):');
leitura('Get-Process');
leitura('Get-Service | Where-Object { $_.Status -eq "Running" }');
leitura('Get-ChildItem C:\\Windows | Select-Object -First 5');
leitura('Get-ItemProperty "HKCU:\\Control Panel\\Desktop"');
leitura('Get-CimInstance Win32_VideoController | Format-List');
leitura('Test-Path C:\\Windows\\System32');
leitura('ls | sort | select -First 3');
leitura('Get-Process | Measure-Object -Property WS -Sum');
leitura('Get-ScheduledTask | Where-Object State -eq Ready');

console.log('\nMudança óbvia (tem que barrar):');
mudanca('Stop-Process -Name notepad');
mudanca('Remove-Item C:\\temp -Recurse -Force');
mudanca('Set-ItemProperty "HKCU:\\Control Panel\\Desktop" ScreenSaveTimeOut 0');
mudanca('New-Item -Path C:\\x -ItemType Directory');
mudanca('Start-Process notepad');
mudanca('powercfg /change monitor-timeout-ac 0');
mudanca('reg add HKCU\\Software\\X /v Y /d 1');
mudanca('Restart-Service Spooler');
mudanca('Disable-ScheduledTask -TaskName X');

console.log('\nDisfarces (o que este teste existe para pegar):');
mudanca('Get-Process; Remove-Item C:\\x', 'ponto-e-vírgula esconde um segundo comando');
mudanca('Get-Process | Out-File C:\\x.txt', 'Out-File grava arquivo');
mudanca('Get-Content a.txt > b.txt', 'redirecionamento grava');
mudanca('Get-Process | Stop-Process', 'pipe para cmdlet que mata processo');
mudanca('iex (Get-Content payload.ps1 -Raw)', 'Invoke-Expression executa texto');
mudanca('Get-Process | ForEach-Object { $_.Kill() }', 'método .NET no meio do bloco');
mudanca('[System.IO.File]::Delete("C:\\x")', 'chamada estática de .NET');
mudanca('Get-Item $(Remove-Item C:\\x)', 'subexpressão executa antes');
mudanca('& "C:\\meu.exe"', 'operador de chamada');
mudanca('cmd /c del C:\\x', 'shell aninhado');
mudanca('powershell -c "Remove-Item C:\\x"', 'PowerShell aninhado');
mudanca('Get-Process `; Remove-Item C:\\x', 'crase escapando');
mudanca('Add-Type -TypeDefinition $codigo', 'compila código');
mudanca('New-Object -ComObject WScript.Shell', 'New-Object alcança COM');
mudanca('Invoke-Command -ScriptBlock { Remove-Item C:\\x }', 'Invoke-Command');
mudanca('$x = Get-Process', 'atribuição não é reconhecida como leitura');
mudanca('Copy-Item a b', 'Copy-Item escreve');
mudanca('Export-Csv -Path x.csv', 'Export grava');

console.log('\nBordas:');
mudanca('', 'vazio');
mudanca('   ', 'só espaço');
mudanca('Get-Process ' + 'x'.repeat(2100), 'longo demais para conferir');
leitura('  Get-Process  ');
checa('motivo é preenchido quando barra', classificar('Stop-Process').motivo.length > 0);
checa('motivo é vazio quando passa', classificar('Get-Process').motivo === '');

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
