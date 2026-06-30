; DigiLog - Inno Setup installer definition
; Builds a customer-facing Setup.exe that installs DigiLog + a private bundled
; PostgreSQL as auto-starting Windows services, with no prerequisites.
; See tasks/EXE-PACKAGING-PLAN.md (M5).
;
; Compile with Inno Setup 6:   ISCC.exe /DStageDir=<staging> /DAppVersion=1.0.0 installer\DigiLog.iss
; The staging dir is produced by scripts/build-installer.ps1 and must contain:
;   runtime\   pgsql\   service\   scripts\
;
; NOTE: this .iss is authored + reviewed here, but COMPILING it to Setup.exe
; requires Inno Setup on a build machine, and TEST-INSTALLING requires admin.
; Those two steps run on the build/customer machine, not in this repo.

#ifndef StageDir
  #define StageDir "..\dist\stage"
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{8F3B2C71-1A4D-4E9A-9C2B-DIGILOG000001}
AppName=DigiLog
AppVersion={#AppVersion}
AppPublisher=Controlytics
DefaultDirName={autopf}\DigiLog
DefaultGroupName=DigiLog
DisableProgramGroupPage=yes
UninstallDisplayName=DigiLog
UninstallDisplayIcon={app}\runtime\api\dist\app.js
OutputBaseFilename=DigiLog-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes

[Files]
; The whole staged tree -> {app}. recursesubdirs preserves runtime/pgsql/service/scripts.
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; Data root - survives upgrades + uninstall. Created here so ACLs are set early.
Name: "{commonappdata}\DigiLog"; Permissions: service-modify
Name: "{commonappdata}\DigiLog\db"
Name: "{commonappdata}\DigiLog\uploads"
Name: "{commonappdata}\DigiLog\logs"
Name: "{commonappdata}\DigiLog\config"

[Icons]
; Start-menu + desktop shortcut open the app in the default browser.
Name: "{group}\DigiLog"; Filename: "{app}\DigiLog.url"
Name: "{group}\Uninstall DigiLog"; Filename: "{uninstallexe}"
Name: "{commondesktop}\DigiLog"; Filename: "{app}\DigiLog.url"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
; Post-install: generate secrets, provision Postgres, register services, health check.
; -ExecutionPolicy Bypass is required because the bundled scripts are unsigned; the
; installer already runs elevated and the scripts are shipped read-only under {app}.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -InstallDir ""{app}"" -AdminPassword ""{code:GetAdminPassword}"""; \
  StatusMsg: "Setting up the DigiLog database and services (this can take a minute)..."; \
  Flags: runhidden waituntilterminated

[UninstallRun]
; Pre-uninstall: stop + remove services. Data is preserved (see uninstall.ps1).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "DigiLogServices"; Flags: runhidden waituntilterminated

[Code]
var
  AdminPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  AdminPage := CreateInputQueryPage(wpSelectDir,
    'Initial administrator password',
    'Set the password for the built-in ''superadmin'' account.',
    'You will be required to change it on first login. Minimum 8 characters.');
  AdminPage.Add('Initial admin password:', True);  { True = password (masked) }
end;

function GetAdminPassword(Param: string): string;
begin
  Result := AdminPage.Values[0];
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = AdminPage.ID) then
  begin
    if Length(AdminPage.Values[0]) < 8 then
    begin
      MsgBox('The admin password must be at least 8 characters.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Write the browser shortcut target after install. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  UrlPath: string;
begin
  if CurStep = ssPostInstall then
  begin
    UrlPath := ExpandConstant('{app}\DigiLog.url');
    SaveStringToFile(UrlPath, '[InternetShortcut]' + #13#10 + 'URL=http://localhost:3000' + #13#10, False);
  end;
end;
