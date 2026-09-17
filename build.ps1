<#
    Empacota o Diploma e (se o Inno Setup estiver instalado) gera o instalador.

    O que sai em publish\ é a pasta instalada, inteira:
      Diploma.exe         node.exe portátil renomeado — o processo se chama Diploma, e é
                          isso que o instalador mata na atualização (taskkill /IM)
      app\server.mjs      o servidor inteiro num bundle ESM (esbuild), node_modules externo
      web\dist\           a interface
      node_modules\       só dependências de produção (o claude.exe do SDK é o que pesa)
      package.json        de onde o app lê a própria versão
      .instalado          marcador: dados vão para %LOCALAPPDATA%\Diploma, updater liberado

    Uso:
      .\build.ps1                 # publish\ + instalador em dist\
      .\build.ps1 -NoInstaller    # só publish\
      .\build.ps1 -SemTestes      # pula npm run teste (CI faz typecheck e teste rápido)
      .\build.ps1 -Run            # empacota e executa publish\Diploma.exe
#>
[CmdletBinding()]
param(
    [switch]$NoInstaller,
    [switch]$SemTestes,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

$publish = Join-Path $root 'publish'
$dist    = Join-Path $root 'dist'
$cache   = Join-Path $root '.cache'

$pkg     = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$versao  = $pkg.version

Write-Host "== Diploma $versao — build ==" -ForegroundColor Cyan

foreach ($cmd in 'node', 'npm') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "$cmd não encontrado no PATH." -ForegroundColor Red
        exit 1
    }
}

# ---- Verificação ----------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Instalando dependências (npm ci)...' -ForegroundColor Cyan
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Typecheck...' -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host 'Typecheck falhou.' -ForegroundColor Red; exit $LASTEXITCODE }

if (-not $SemTestes) {
    Write-Host 'Testes...' -ForegroundColor Cyan
    npm run teste
    if ($LASTEXITCODE -ne 0) { Write-Host 'Testes falharam.' -ForegroundColor Red; exit $LASTEXITCODE }
}

# ---- Interface ------------------------------------------------------------------------------
Write-Host 'Interface (vite build)...' -ForegroundColor Cyan
npx vite build --logLevel warn
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ---- publish\ do zero -----------------------------------------------------------------------
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
New-Item -ItemType Directory -Path $publish, (Join-Path $publish 'app'), $dist, $cache -Force | Out-Null

# Servidor: um bundle ESM. `--packages=external` deixa node_modules de fora — o SDK
# da Anthropic e o Playwright carregam binários por caminho e não sobrevivem a bundle.
Write-Host 'Servidor (esbuild)...' -ForegroundColor Cyan
npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 `
    --packages=external --log-level=warning --outfile="$publish\app\server.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item (Join-Path $root 'web\dist') (Join-Path $publish 'web\dist') -Recurse

# package.json de produção: só o que o app precisa em runtime. A versão é a mesma —
# é daqui que o servidor lê `VERSION`.
$prod = [ordered]@{
    name         = $pkg.name
    version      = $versao
    private      = $true
    type         = 'module'
    description  = $pkg.description
    dependencies = $pkg.dependencies
}
# Sem BOM: Set-Content -Encoding UTF8 no PowerShell 5.1 grava BOM, e JSON.parse do lado do
# Node não engole BOM — a versão viraria 0.0.0. O leitor também tolera, mas aqui a fonte sai limpa.
[IO.File]::WriteAllText((Join-Path $publish 'package.json'), ($prod | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Dependências de produção (npm install --omit=dev)...' -ForegroundColor Cyan
Push-Location $publish
try {
    # --ignore-scripts: nenhuma dependência precisa de postinstall, e o Playwright NÃO
    # baixa navegador no install — quem baixa o Chromium é o app, depois, no lugar certo.
    npm install --omit=dev --no-audit --no-fund --ignore-scripts --no-package-lock
    if ($LASTEXITCODE -ne 0) { throw 'npm install de produção falhou' }
} finally {
    Pop-Location
}

# ---- Node portátil → Diploma.exe ------------------------------------------------------------
# Mesma versão do node que está rodando o build, para o binário empacotado ser o que foi
# testado. Fica em .cache\ para não baixar de novo a cada build.
$nodeVer = (node --version).Trim()            # v22.20.0
$zipNome = "node-$nodeVer-win-x64.zip"
$zipPath = Join-Path $cache $zipNome
if (-not (Test-Path $zipPath)) {
    Write-Host "Baixando o Node portátil $nodeVer..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVer/$zipNome" -OutFile $zipPath
}
$extraido = Join-Path $cache "node-$nodeVer-win-x64"
if (-not (Test-Path (Join-Path $extraido 'node.exe'))) {
    Expand-Archive -Path $zipPath -DestinationPath $cache -Force
}
Copy-Item (Join-Path $extraido 'node.exe') (Join-Path $publish 'Diploma.exe')

# O marcador que diz ao servidor "você está instalado".
Set-Content (Join-Path $publish '.instalado') "Diploma $versao — instalado por Diploma-Setup. Dados em %LOCALAPPDATA%\Diploma." -Encoding UTF8

$tamanho = [math]::Round(((Get-ChildItem $publish -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 0)
Write-Host ""
Write-Host "OK: $publish ($tamanho MB descompactado)" -ForegroundColor Green

# ---- Instalador -----------------------------------------------------------------------------
if (-not $NoInstaller) {
    $iscc = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"   # instalação por usuário
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($iscc) {
        Write-Host 'Gerando instalador com Inno Setup…' -ForegroundColor Cyan
        # A versão vai por /D: o .iss não lê JSON, e a fonte da verdade é o package.json.
        & $iscc "/DMyAppVersion=$versao" (Join-Path $root 'installer.iss')
        if ($LASTEXITCODE -ne 0) { Write-Host 'ISCC falhou.' -ForegroundColor Red; exit $LASTEXITCODE }
        Get-ChildItem $dist -Filter "Diploma-Setup-$versao.exe" | ForEach-Object {
            $mb = [math]::Round($_.Length / 1MB, 1)
            Write-Host ("Instalador: " + $_.FullName + " ($($mb) MB)") -ForegroundColor Green
        }
    } else {
        Write-Host 'Inno Setup 6 não encontrado — instalador não gerado.' -ForegroundColor Yellow
        Write-Host 'Para gerar:  winget install JRSoftware.InnoSetup   e rode este script de novo.'
        Write-Host 'Sem instalador o app funciona igual: publish\Diploma.exe app\server.mjs --abrir'
    }
}

if ($Run) {
    Write-Host 'Iniciando…' -ForegroundColor Cyan
    Start-Process (Join-Path $publish 'Diploma.exe') -ArgumentList 'app\server.mjs', '--abrir' -WorkingDirectory $publish
}
