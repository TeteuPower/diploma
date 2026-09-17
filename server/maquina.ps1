#Requires -Version 5.1
<#
    A camada de máquina do Diploma, em PowerShell porque a UI Automation do
    Windows mora no .NET que já vem no sistema — nada a instalar.

    É o MESMO modelo do navegador: uma árvore de acessibilidade vira texto com
    refs, e as ações endereçam por ref. O que muda é o endereço: no navegador o
    ref é um atributo carimbado no DOM; aqui o processo PowerShell morre a cada
    chamada, então o ref carrega o CAMINHO (pid + índices de filho) e a ação
    re-anda esse caminho, conferindo o nome no fim. Elemento que mudou de lugar
    não responde — igual a ref velho de página recarregada.

    Ações usam os PADRÕES da UIA (Invoke, Toggle, Value, ExpandCollapse) em vez
    de mover o mouse: não roubam o cursor do dono e funcionam com a janela
    parcialmente coberta. Clique por coordenada é o último recurso.

    Uso:  -Acao janelas | arvore | clicar | escrever | alternar | captura | focar |
          abrir | teclado | esperar | ler-transferencia | escrever-transferencia
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Acao,
    [string]$Atalho = '',
    [string]$Programa = '',
    [string]$Argumentos = '',
    [int]$Segundos = 15,
    [string]$Esperado = '',
    [int]$Processo = 0,
    [string]$Caminho = '',
    [string]$Texto = '',
    [string]$Destino = '',
    [int]$MaxLinhas = 250,
    [int]$MaxProfundidade = 12
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Saida($obj) { $obj | ConvertTo-Json -Depth 8 -Compress }

function Tipo($el) { $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', '' }

<#  Janelas de topo que valem a pena: com nome, visíveis, não a própria área de
    trabalho. É por elas que o agente escolhe onde agir. #>
function Get-Janelas {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::IsControlElementProperty, $true)
    $lista = @()
    foreach ($j in $AE::RootElement.FindAll($TS::Children, $cond)) {
        $c = $j.Current
        if (-not $c.Name) { continue }
        if ($c.IsOffscreen) { continue }
        $r = $c.BoundingRectangle
        if ($r.Width -le 0 -or $r.Height -le 0) { continue }
        $lista += [ordered]@{
            pid    = $c.ProcessId
            nome   = $c.Name
            tipo   = Tipo $j
            classe = $c.ClassName
            x      = [int]$r.X; y = [int]$r.Y; largura = [int]$r.Width; altura = [int]$r.Height
        }
    }
    $lista
}

function Get-JanelaPorPid([int]$alvo) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $alvo)
    $j = $AE::RootElement.FindFirst($TS::Children, $cond)
    if (-not $j) { throw "nenhuma janela de topo do processo $alvo" }
    $j
}

<#  Anda o caminho de indices a partir da janela.

    A CONFERENCIA do nome no fim nao e zelo: o indice do irmao MUDA quando a
    arvore muda. Na Calculadora, o botao "Um" saiu de 1.1.1.6.1 para 1.1.1.5.1
    entre duas leituras, e sem conferir o caminho antigo resolveria para outro
    botao — clique errado, silencioso, com cara de sucesso. Ref que nao bate
    falha alto, e o agente le de novo (igual a ref velho de pagina recarregada). #>
function Resolve-Caminho([int]$alvo, [string]$caminhoTxt, [string]$esperado = '') {
    $el = Get-JanelaPorPid $alvo
    if (-not $caminhoTxt) { return $el }
    $condFilhos = New-Object System.Windows.Automation.PropertyCondition($AE::IsControlElementProperty, $true)
    foreach ($i in $caminhoTxt.Split('.')) {
        $filhos = $el.FindAll($TS::Children, $condFilhos)
        $idx = [int]$i
        if ($idx -lt 0 -or $idx -ge $filhos.Count) {
            throw "o caminho nao existe mais (indice $idx de $($filhos.Count)) — tire um instantaneo novo"
        }
        $el = $filhos.Item($idx)
    }
    if ($esperado) {
        $atual = ($el.Current.Name -replace '\s+', ' ').Trim()
        if ($atual -ne $esperado) {
            throw "a arvore mudou: neste caminho havia '$esperado' e agora ha '$atual'. Leia a janela de novo."
        }
    }
    $el
}

<#  A árvore em texto, no formato do instantâneo do navegador. Cada elemento
    acionável ganha `ref=<pid>:<caminho>`. #>
function Get-Arvore([int]$alvo, [int]$maxLinhas, [int]$maxProf) {
    $janela = Get-JanelaPorPid $alvo
    $linhas = New-Object System.Collections.Generic.List[string]
    $condFilhos = New-Object System.Windows.Automation.PropertyCondition($AE::IsControlElementProperty, $true)
    $script:cortado = $false

    function Visitar($el, [string]$caminho, [int]$prof) {
        if ($linhas.Count -ge $maxLinhas) { $script:cortado = $true; return }
        if ($prof -gt $maxProf) { return }
        $c = $el.Current
        if ($c.IsOffscreen) { return }

        $nome = $c.Name
        $tipo = Tipo $el

        # Estado que muda a decisão: marcado, valor, expandido, desabilitado.
        $estado = @()
        if (-not $c.IsEnabled) { $estado += 'desabilitado' }
        try { $t = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
              $estado += if ($t.Current.ToggleState -eq 'On') { 'marcado' } else { 'desmarcado' } } catch {}
        try { $v = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
              if ($v.Current.Value) { $estado += "valor=`"$($v.Current.Value -replace '"','')`"" } } catch {}
        try { $e = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
              $estado += if ($e.Current.ExpandCollapseState -eq 'Expanded') { 'aberto' } else { 'fechado' } } catch {}

        $emitiu = $false
        if ($nome -or $estado.Count) {
            $recuo = '  ' * [Math]::Min($prof, 8)
            $ref = if ($caminho) { " ref=$alvo`:$caminho" } else { '' }
            $est = if ($estado.Count) { ' [' + ($estado -join ', ') + ']' } else { '' }
            # Nome de uma linha só: o Chrome manda "Adblock Plus`nTem acesso a este
            # site" num botao, e a quebra estouraria o formato "um elemento por linha".
            $limpo = ($nome -replace '\s+', ' ').Trim()
            $nomeCurto = if ($limpo.Length -gt 120) { $limpo.Substring(0, 120) + '…' } else { $limpo }
            $linhas.Add("$recuo- $tipo `"$nomeCurto`"$ref$est")
            $emitiu = $true
        }

        # So desce o recuo quando algo FOI emitido: ancestral anonimo (os panes
        # aninhados do Chrome) afundava os filhos oito niveis sem dizer nada.
        $profFilhos = if ($emitiu) { $prof + 1 } else { $prof }
        $filhos = $el.FindAll($TS::Children, $condFilhos)
        for ($i = 0; $i -lt $filhos.Count; $i++) {
            $sub = if ($caminho) { "$caminho.$i" } else { "$i" }
            Visitar $filhos.Item($i) $sub $profFilhos
        }
    }

    Visitar $janela '' 0
    [ordered]@{
        pid     = $alvo
        titulo  = $janela.Current.Name
        linhas  = ($linhas -join "`n")
        total   = $linhas.Count
        cortado = $script:cortado
    }
}

<#  Clique pelo padrão da UIA. Invoke serve botão e link; Toggle serve caixa e
    rádio; se nenhum existir, cai no clique por coordenada no centro. #>
function Invoke-Elemento($el) {
    try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return 'invoke' } catch {}
    try { $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle(); return 'toggle' } catch {}
    try { $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); return 'select' } catch {}
    try {
        $e = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($e.Current.ExpandCollapseState -eq 'Expanded') { $e.Collapse() } else { $e.Expand() }
        return 'expand'
    } catch {}

    # Último recurso: mover o cursor e clicar. Rouba o mouse do dono por um
    # instante — por isso vem por último, e o log diz que foi por aqui.
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 0) { throw 'elemento sem padrao de clique e sem area na tela' }
    Add-Type -Namespace Win32 -Name Mouse -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
'@ -ErrorAction SilentlyContinue
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 60
    [Win32.Mouse]::mouse_event(0x02, 0, 0, 0, 0)   # esquerdo pressiona
    [Win32.Mouse]::mouse_event(0x04, 0, 0, 0, 0)   # esquerdo solta
    'coordenada'
}


<#  Teclas: nome legivel -> codigo virtual. So o que um atalho precisa; letra e
    digito vao pelo codigo ASCII do proprio caractere. #>
$VK = @{
  'win'=0x5B; 'ctrl'=0x11; 'control'=0x11; 'alt'=0x12; 'shift'=0x10;
  'enter'=0x0D; 'return'=0x0D; 'tab'=0x09; 'esc'=0x1B; 'escape'=0x1B;
  'space'=0x20; 'backspace'=0x08; 'delete'=0x2E; 'del'=0x2E; 'home'=0x24; 'end'=0x23;
  'pgup'=0x21; 'pgdn'=0x22; 'up'=0x26; 'down'=0x28; 'left'=0x25; 'right'=0x27;
  'f1'=0x70; 'f2'=0x71; 'f3'=0x72; 'f4'=0x73; 'f5'=0x74; 'f6'=0x75;
  'f7'=0x76; 'f8'=0x77; 'f9'=0x78; 'f10'=0x79; 'f11'=0x7A; 'f12'=0x7B;
}

<#  Atalho de verdade (inclusive com a tecla Windows, que o SendKeys nao alcanca):
    pressiona os modificadores, bate a tecla final, solta na ordem inversa. #>
function Enviar-Atalho([string]$combo) {
  Add-Type -Namespace Win32 -Name Tecla -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, int e);
'@ -ErrorAction SilentlyContinue

  $partes = $combo.ToLower().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if (-not $partes) { throw "atalho vazio" }
  $codigos = @()
  foreach ($t in $partes) {
    if ($VK.ContainsKey($t)) { $codigos += $VK[$t] }
    elseif ($t.Length -eq 1) { $codigos += [byte][char]($t.ToUpper()) }
    else { throw "tecla desconhecida: $t" }
  }
  foreach ($c in $codigos) { [Win32.Tecla]::keybd_event([byte]$c, 0, 0, 0); Start-Sleep -Milliseconds 30 }
  [array]::Reverse($codigos)
  foreach ($c in $codigos) { [Win32.Tecla]::keybd_event([byte]$c, 0, 2, 0); Start-Sleep -Milliseconds 30 }
}

switch ($Acao) {
    'janelas' { Saida (Get-Janelas) }

    'arvore' { Saida (Get-Arvore $Processo $MaxLinhas $MaxProfundidade) }

    'focar' {
        $j = Get-JanelaPorPid $Processo
        try { $j.SetFocus() } catch {}
        Saida ([ordered]@{ ok = $true; titulo = $j.Current.Name })
    }

    'clicar' {
        $el = Resolve-Caminho $Processo $Caminho $Esperado
        $via = Invoke-Elemento $el
        Start-Sleep -Milliseconds 350
        Saida ([ordered]@{ ok = $true; via = $via; alvo = $el.Current.Name })
    }

    'alternar' {
        $el = Resolve-Caminho $Processo $Caminho $Esperado
        $t = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        $antes = $t.Current.ToggleState
        $t.Toggle()
        Start-Sleep -Milliseconds 250
        Saida ([ordered]@{ ok = $true; antes = "$antes"; depois = "$($t.Current.ToggleState)" })
    }

    'escrever' {
        $el = Resolve-Caminho $Processo $Caminho $Esperado
        try {
            $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Texto)
            Saida ([ordered]@{ ok = $true; via = 'value' })
        } catch {
            # Campo sem ValuePattern (editor custom): foca e digita.
            $el.SetFocus(); Start-Sleep -Milliseconds 120
            [System.Windows.Forms.SendKeys]::SendWait($Texto -replace '([+^%~(){}])', '{$1}')
            Saida ([ordered]@{ ok = $true; via = 'teclado' })
        }
    }

    'captura' {
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
        # Reduz para caber no contexto da LLM sem virar um anexo gigante.
        $escala = [Math]::Min(1.0, 1600 / $b.Width)
        $larg = [int]($b.Width * $escala); $alt = [int]($b.Height * $escala)
        $peq = New-Object System.Drawing.Bitmap($larg, $alt)
        $g2 = [System.Drawing.Graphics]::FromImage($peq)
        $g2.InterpolationMode = 'HighQualityBicubic'
        $g2.DrawImage($bmp, 0, 0, $larg, $alt)
        $ms = New-Object System.IO.MemoryStream
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $par = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $par.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 60L)
        $peq.Save($ms, $codec, $par)
        $g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $peq.Dispose()
        Saida ([ordered]@{ ok = $true; largura = $larg; altura = $alt; base64 = [Convert]::ToBase64String($ms.ToArray()) })
    }

    'abrir' {
        # Start-Process resolve caminho completo, nome no PATH e App Paths do
        # registro — e assim "wallpaper64" ou o .exe inteiro funcionam igual.
        $p = if ($Argumentos) { Start-Process -FilePath $Programa -ArgumentList $Argumentos -PassThru }
             else { Start-Process -FilePath $Programa -PassThru }
        Start-Sleep -Milliseconds 700
        Saida ([ordered]@{ ok = $true; processo = $p.Id; nome = $p.ProcessName })
    }

    'teclado' {
        if ($Atalho) { Enviar-Atalho $Atalho }
        if ($Texto) {
            # SendKeys trata +^%~(){}[] como sintaxe: escapamos para digitar literal.
            [System.Windows.Forms.SendKeys]::SendWait(($Texto -replace '([+^%~(){}\[\]])', '{$1}'))
        }
        Start-Sleep -Milliseconds 250
        Saida ([ordered]@{ ok = $true; atalho = $Atalho; chars = $Texto.Length })
    }

    'esperar' {
        # Programa recem-aberto leva um tempo ate a janela existir na arvore da UIA.
        $fim = (Get-Date).AddSeconds($Segundos)
        do {
            foreach ($j in (Get-Janelas)) {
                if ($j.nome -like "*$Texto*") { Saida ([ordered]@{ ok = $true; achou = $true; processo = $j.pid; nome = $j.nome }); exit 0 }
            }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $fim)
        Saida ([ordered]@{ ok = $true; achou = $false })
    }

    'ler-transferencia' {
        $t = Get-Clipboard -Raw
        Saida ([ordered]@{ ok = $true; texto = if ($t) { $t } else { '' } })
    }

    'escrever-transferencia' {
        Set-Clipboard -Value $Texto
        Saida ([ordered]@{ ok = $true; chars = $Texto.Length })
    }

    default { throw "acao desconhecida: $Acao" }
}
