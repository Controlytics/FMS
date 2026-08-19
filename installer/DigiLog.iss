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
; Where the finished Setup.exe is written. build-installer.ps1 passes this as
; /DOutputDir=<repo>\dist so its sign step + final message find the exe. When
; ISCC is run by hand without the define, fall back to Inno's default Output\.
#ifndef OutputDir
  #define OutputDir "Output"
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
OutputDir={#OutputDir}
OutputBaseFilename=DigiLog-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 / Server 2016 or newer. Below this the Universal CRT
; (api-ms-win-crt-*.dll, imported by the bundled PostgreSQL binaries) is not
; in-box and needs KB2999226, which we do not ship. Declaring the floor makes
; Setup refuse cleanly instead of failing later inside install.ps1.
MinVersion=10.0
SetupLogging=yes

[Files]
; KEEP THIS ENTRY FIRST. With SolidCompression=yes the archive decompresses in
; [Files] order, so a file pulled by ExtractTemporaryFile() from further down would
; force Setup to decompress the whole ~1 GB payload before PrepareToInstall() could
; run it. First = extracted immediately.
; dontcopy: carried inside Setup, run by PrepareToInstall(), never placed in {app}.
; The bundled PostgreSQL binaries (postgres/initdb/pg_ctl/pg_dump/openssl) import
; VCRUNTIME140.dll, vcruntime140_1.dll and msvcp140.dll, which are NOT part of
; Windows. node.exe, the Prisma query engine and bcrypt static-link the CRT and
; do not need this.
Source: "{#StageDir}\prereq\VC_redist.x64.exe"; Flags: dontcopy

; Program payload -> {app}. Split so upgrades handle running processes correctly:
;  - pgsql (bundled PostgreSQL binaries): onlyifdoesntexist. On upgrade the DB
;    service stays RUNNING (postgres.exe would be locked), and we WANT it up so
;    upgrade.ps1 can pg_dump a live backup before migrating. Skipping the copy on
;    upgrade both avoids the file lock and preserves the working PG binaries.
;    (A future PostgreSQL binary bump is a special, out-of-band migration.)
;  - runtime + service + scripts: ignoreversion (replaced every upgrade). These
;    are freed by stopping DigiLogAPI in PrepareToInstall() BEFORE this copy runs.
Source: "{#StageDir}\pgsql\*";   DestDir: "{app}\pgsql";   Flags: recursesubdirs createallsubdirs onlyifdoesntexist
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\service\*"; DestDir: "{app}\service"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion

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
Name: "{group}\Install tablet certificate (rootCA.pem)"; Filename: "{commonappdata}\DigiLog\certs"; Comment: "Copy rootCA.pem to the tablet and install it under Settings > Security > Install certificate"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
; -ExecutionPolicy Bypass is required because the bundled scripts are unsigned; the
; installer already runs elevated and the scripts are shipped read-only under {app}.
;
; FRESH install: generate secrets, provision Postgres, register services, health check.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -InstallDir ""{app}"" -AdminPassword ""{code:GetAdminPassword}"""; \
  StatusMsg: "Setting up the DigiLog database and services (this can take a minute)..."; \
  Flags: runhidden waituntilterminated; Check: not IsUpgrade
;
; UPGRADE: pre-upgrade DB backup, forward-only migrate deploy, reseed, restart API.
; Preserves all data + secrets in C:\ProgramData\DigiLog.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\upgrade.ps1"" -InstallDir ""{app}"" -Version ""{#AppVersion}"""; \
  StatusMsg: "Backing up and upgrading the DigiLog database (this can take a minute)..."; \
  Flags: runhidden waituntilterminated; Check: IsUpgrade

[UninstallRun]
; Pre-uninstall: stop + remove services. Data is preserved (see uninstall.ps1).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "DigiLogServices"; Flags: runhidden waituntilterminated

[Code]
var
  AdminPage: TInputQueryWizardPage;
  IsUpgradeFlag: Boolean;

{ An install is an UPGRADE iff the data-root env file already exists. That file
  holds the generated secrets + DB connection and only ever exists after a prior
  successful install; it lives in ProgramData and survives program replacement. }
function IsUpgrade: Boolean;
begin
  Result := IsUpgradeFlag;
end;

procedure InitializeWizard;
begin
  IsUpgradeFlag := FileExists(ExpandConstant('{commonappdata}\DigiLog\config\digilog.env'));
  AdminPage := CreateInputQueryPage(wpSelectDir,
    'Initial administrator password',
    'Set the password for the built-in ''superadmin'' account.',
    'You will be required to change it on first login. Minimum 8 characters.');
  AdminPage.Add('Initial admin password:', True);  { True = password (masked) }
end;

{ Skip the admin-password page on upgrade: the superadmin already exists and its
  password is never touched (the seed upsert preserves it). }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if IsUpgradeFlag and (PageID = AdminPage.ID) then
    Result := True;
end;

function GetAdminPassword(Param: string): string;
begin
  Result := AdminPage.Values[0];
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (not IsUpgradeFlag) and (CurPageID = AdminPage.ID) then
  begin
    if Length(AdminPage.Values[0]) < 8 then
    begin
      MsgBox('The admin password must be at least 8 characters.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Is the VC++ 2015-2022 x64 runtime missing or too old?
  Gate = HKLM64\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64. We require
  >= 14.30 (VS2022 toolset, which built the bundled PostgreSQL 18): vcruntime140_1.dll
  only appeared in 14.20, so an ancient 14.0 runtime would satisfy a bare "Installed=1"
  check and still leave postgres.exe unable to load. Any read failure => assume needed;
  re-running the redist when it is already current is cheap and idempotent. }
function VCRedistNeeded: Boolean;
var
  Installed, Major, Minor: Cardinal;
  Key: String;
begin
  Result := True;
  Key := 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64';
  if not RegQueryDWordValue(HKLM64, Key, 'Installed', Installed) then Exit;
  if Installed <> 1 then Exit;
  if not RegQueryDWordValue(HKLM64, Key, 'Major', Major) then Exit;
  if not RegQueryDWordValue(HKLM64, Key, 'Minor', Minor) then Exit;
  if (Major > 14) or ((Major = 14) and (Minor >= 30)) then
    Result := False;
end;

{ Runs BEFORE the [Files] copy. Two jobs, in order:
  (1) ensure the VC++ runtime the bundled PostgreSQL needs is present, and
  (2) on upgrade, stop the API service so its running
  node.exe + WinSW service exe are unlocked and can be overwritten. The DB service
  is deliberately LEFT RUNNING: pgsql is copied onlyifdoesntexist (so postgres.exe
  is never overwritten and never locks the copy), and upgrade.ps1 needs the DB up
  to take a pre-upgrade pg_dump backup. `net stop` blocks until the service stops. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';

  { 1. VC++ runtime BEFORE anything else, on fresh install AND upgrade.
       Not gated on IsUpgrade: upgrade.ps1 step 4 shells out to pg_dump.exe, which
       has the same dependency, and the redist is idempotent.
       Ordering matters for diagnosis - install.ps1 step 1b calls pgsql\bin\openssl.exe
       to generate the HTTPS certs, so a missing CRT surfaces as a confusing
       certificate failure long before initdb ever runs. }
  if VCRedistNeeded then
  begin
    ExtractTemporaryFile('VC_redist.x64.exe');
    if not Exec(ExpandConstant('{tmp}\VC_redist.x64.exe'), '/install /quiet /norestart', '',
                SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      Result := 'Could not start the Microsoft Visual C++ Redistributable installer.';
      Exit;
    end;
    { 0 = installed, 1638 = a newer runtime is already present (success for us),
      3010 = installed but a reboot is pending. Anything else is fatal: continuing
      would fail inside install.ps1 with a far less obvious message. }
    if ResultCode = 3010 then
      NeedsRestart := True
    else if (ResultCode <> 0) and (ResultCode <> 1638) then
    begin
      Result := 'The Microsoft Visual C++ Redistributable failed to install (code ' +
                IntToStr(ResultCode) + ').' + #13#10 +
                'DigiLog''s bundled PostgreSQL requires it. Install VC_redist.x64.exe ' +
                'manually, then run this installer again.';
      Exit;
    end;
  end;

  { 2. On upgrade, free the running API so [Files] can overwrite it. }
  if IsUpgradeFlag then
  begin
    Exec('net.exe', 'stop DigiLogAPI', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(2000);  { give Windows a moment to release the exe file handles }
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
    SaveStringToFile(UrlPath, '[InternetShortcut]' + #13#10 + 'URL=https://localhost:3000' + #13#10, False);
  end;
end;
