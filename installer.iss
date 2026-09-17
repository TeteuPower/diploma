; Instalador do Diploma (Inno Setup 6)
; Gere com: .\build.ps1   — a versão chega por /DMyAppVersion=X.Y.Z, lida do package.json.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "Diploma"
#define MyAppExe "Diploma.exe"

[Setup]
AppId={{B7D3F2A1-6E4C-4B9A-9D21-3F8E5C7A1D42}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=Diploma
AppPublisherURL=https://github.com/TeteuPower/diploma
AppSupportURL=https://github.com/TeteuPower/diploma/issues
AppUpdatesURL=https://github.com/TeteuPower/diploma/releases
VersionInfoVersion={#MyAppVersion}
UninstallDisplayName={#MyAppName}
DefaultDirName={autopf}\Diploma
DefaultGroupName=Diploma
DisableProgramGroupPage=yes
; numa atualização a pasta e as opções anteriores são reaproveitadas sem perguntar de novo
DisableDirPage=auto
UsePreviousAppDir=yes
UsePreviousTasks=yes
; o app rodando é fechado pelo código abaixo (taskkill), não pelo Restart Manager
CloseApplications=no
; por usuário, sem admin: {autopf} vira %LOCALAPPDATA%\Programs e o updater troca sem elevação
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist
OutputBaseFilename=Diploma-Setup-{#MyAppVersion}
UninstallDisplayIcon={app}\{#MyAppExe}
; o claude.exe do SDK tem 220 MB e comprime bem: lzma2/max compensa o tempo de build
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked
; O Chromium não vem no instalador: são ~150 MB que mudam a cada versão do Playwright e
; que ele já guarda em %LOCALAPPDATA%\ms-playwright, onde sobrevivem a atualização.
Name: "chromium"; Description: "Baixar o navegador (Chromium, ~150 MB) agora — precisa de internet"; GroupDescription: "Navegador:"

[Files]
; publish\ é a pasta instalada inteira, montada pelo build.ps1
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Parameters: "app\server.mjs --abrir"; WorkingDir: "{app}"; Comment: "Copiloto de LMS e web"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Parameters: "app\server.mjs --abrir"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Chromium pelo próprio Playwright, com o node empacotado — nada de npm na máquina do dono.
Filename: "{app}\{#MyAppExe}"; Parameters: "node_modules\playwright\cli.js install chromium"; WorkingDir: "{app}"; \
    StatusMsg: "Baixando o Chromium (pode levar alguns minutos)..."; Flags: waituntilterminated skipifsilent; Tasks: chromium
Filename: "{app}\{#MyAppExe}"; Parameters: "app\server.mjs --abrir"; WorkingDir: "{app}"; \
    Description: "Abrir o {#MyAppName} agora"; Flags: nowait postinstall skipifsilent
; atualização feita pelo próprio app: ele foi fechado para a troca dos arquivos, então
; quem o inicia de volta é o instalador
Filename: "{app}\{#MyAppExe}"; Parameters: "app\server.mjs --abrir"; WorkingDir: "{app}"; Flags: nowait; Check: WizardSilent

; Sem [UninstallDelete] de %LOCALAPPDATA%\Diploma de propósito: lá estão o cofre, as sessões e
; os TRABALHOS do dono. Desinstalar o programa não pode apagar trabalho de faculdade.

[Code]
const
  UninstallKey =
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B7D3F2A1-6E4C-4B9A-9D21-3F8E5C7A1D42}_is1';

var
  IsUpgrade: Boolean;

{ Fecha o servidor que estiver rodando: o processo se chama Diploma.exe porque o node.exe
  foi renomeado justamente para isto. Os dados ficam em %LOCALAPPDATA% e são gravados na
  hora em que mudam (escrita atômica), então nada se perde. }
procedure StopRunningApp;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#MyAppExe} /F', '',
       SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(800);
end;

function InitializeSetup(): Boolean;
var
  Previous: String;
begin
  IsUpgrade := RegQueryStringValue(HKA, UninstallKey, 'UninstallString', Previous);
  Result := True;
end;

{ Atualização: nada de perguntar pasta, tarefas ou confirmação de novo. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpgrade and ((PageID = wpSelectTasks) or (PageID = wpReady));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningApp;
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp;
  Result := True;
end;
