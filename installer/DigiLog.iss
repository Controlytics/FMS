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
; The product is shown as "FMS" (2026-10-14, operator). Only what a person SEES
; changed: AppId, the install folder, C:\ProgramData\DigiLog, the service names
; (DigiLogDB / DigiLogAPI) and DigiLog.url are UNCHANGED on purpose - upgrade
; detection, the scripts and an existing install's data all depend on them.
AppId={{8F3B2C71-1A4D-4E9A-9C2B-DIGILOG000001}
AppName=FMS
AppVerName=FMS {#AppVersion}
AppVersion={#AppVersion}
AppPublisher=Controlytics
DefaultDirName={autopf}\DigiLog
DefaultGroupName=FMS
DisableProgramGroupPage=yes
UninstallDisplayName=FMS
UninstallDisplayIcon={app}\runtime\api\dist\app.js
OutputDir={#OutputDir}
OutputBaseFilename=FMS-Setup-{#AppVersion}
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
; OpenSSL CLI, kept OUT of {app}\pgsql on purpose: it carries libcrypto/libssl DLLs
; under the same filenames PostgreSQL uses but at a different patch level, and
; overwriting the database's own crypto libraries to obtain a CLI is not acceptable.
; install.ps1 resolves openssl from here. PostgreSQL ships no openssl.exe of its own.
Source: "{#StageDir}\openssl\*"; DestDir: "{app}\openssl"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StageDir}\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion
; The tablet app, so one Setup.exe carries everything a site needs. Copied to the
; tablet by hand (with rootCA.pem from the certificate shortcut) and installed there.
Source: "{#StageDir}\tablet\*"; DestDir: "{app}\tablet"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; Shortcuts made by installers before the FMS rename (<= 1.1.2). Without this an
; upgraded machine shows both a "DigiLog" and an "FMS" Start-menu group.
Type: filesandordirs; Name: "{commonprograms}\DigiLog"
Type: files; Name: "{commondesktop}\DigiLog.lnk"

[Dirs]
; Data root - survives upgrades + uninstall. Created here so ACLs are set early.
Name: "{commonappdata}\DigiLog"; Permissions: service-modify
Name: "{commonappdata}\DigiLog\db"
Name: "{commonappdata}\DigiLog\uploads"
Name: "{commonappdata}\DigiLog\logs"
Name: "{commonappdata}\DigiLog\config"

[Icons]
; Start-menu + desktop shortcut open the app in the default browser.
Name: "{group}\FMS"; Filename: "{app}\DigiLog.url"
Name: "{group}\Uninstall FMS"; Filename: "{uninstallexe}"
Name: "{commondesktop}\FMS"; Filename: "{app}\DigiLog.url"; Tasks: desktopicon
Name: "{group}\Install tablet certificate (rootCA.pem)"; Filename: "{commonappdata}\DigiLog\certs"; Comment: "Copy rootCA.pem to the tablet and install it under Settings > Security > Install certificate"
Name: "{group}\Tablet app (FMS.apk)"; Filename: "{app}\tablet"; Comment: "Copy FMS.apk to the tablet and install it (install the certificate first)"
; The ONE file for this server's names / IPs / port, and the action that applies it
; (certificate, port, allowed origins, firewall, restart). apply-addresses.cmd asks for
; Administrator itself. tasks/AUTO-IP-RECOVERY-PLAN.md, Part 3.
Name: "{group}\Edit server addresses"; Filename: "{app}\scripts\edit-addresses.cmd"; Comment: "Change the server's IP, name or port, then run Apply server addresses"
Name: "{group}\Apply server addresses"; Filename: "{app}\scripts\apply-addresses.cmd"; Comment: "Apply digilog-addresses.ini: certificate, port, allowed origins, firewall, restart"
; Switch to a company / bought HTTPS certificate (.pfx, or .crt + .key) or back to the
; FMS's own: checked first, rolled back automatically. Asks for Administrator itself.
Name: "{group}\Change SSL certificate"; Filename: "{app}\scripts\set-certificate.cmd"; Comment: "Use a certificate from IT (checked first, rolled back if FMS does not start), or go back to the FMS certificate"
; Restore the database from a nightly / pre-upgrade / downloaded backup of any size
; (the in-app restore stops at 100 MB). Asks for Administrator itself. D-DB-6.
Name: "{group}\Restore database from backup"; Filename: "{app}\scripts\restore-database.cmd"; Comment: "Replace the database with a backup file (safety backup first; see the restore guide)"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

; No [Run] section. install.ps1 / upgrade.ps1 are run from CurStepChanged(ssPostInstall)
; below, through run-setup-script.iss, because a [Run] entry's exit code is never
; checked and its command line is written to Setup's log (it held the password).

[UninstallRun]
; Pre-uninstall: stop + remove services. Data is preserved (see uninstall.ps1).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "DigiLogServices"; Flags: runhidden waituntilterminated

#include "run-setup-script.iss"

[Code]
var
  AdminPage: TInputQueryWizardPage;
  IsUpgradeFlag: Boolean;

{ Written by install.ps1 when a first install starts on an EMPTY data root and
  deleted once the database is migrated and seeded. Present next to digilog.env
  = a first install stopped before its database was complete. }
function IncompleteFirstInstallMarker: String;
begin
  Result := ExpandConstant('{commonappdata}\DigiLog\config\install-incomplete');
end;

{ An install is an UPGRADE iff the data-root env file already exists. That file
  holds the generated secrets + DB connection and only ever exists after a prior
  successful install; it lives in ProgramData and survives program replacement. }
function IsUpgrade: Boolean;
begin
  Result := IsUpgradeFlag;
end;

procedure InitializeWizard;
begin
  SetupDataRoot := ExpandConstant('{commonappdata}\DigiLog');
  IsUpgradeFlag := FileExists(ExpandConstant('{commonappdata}\DigiLog\config\digilog.env'));
  { The seed does NOT force a change at first login (forcePasswordChange=false):
    the person installing chose this password. The old text promised a forced
    change that never happened. }
  AdminPage := CreateInputQueryPage(wpSelectDir,
    'Administrator password',
    'Set the password for the built-in ''superadmin'' account.',
    'You will sign in to FMS as superadmin with this password. Keep it safe: it is ' +
    'the only account on a new system. At least 8 characters, with an upper-case ' +
    'letter, a lower-case letter, a number and a special character.');
  AdminPage.Add('Password:', True);          { True = password (masked) }
  AdminPage.Add('Confirm password:', True);
end;

{ Skip the admin-password page on upgrade: the superadmin already exists and its
  password is never touched (the seed upsert preserves it). }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if IsUpgradeFlag and (PageID = AdminPage.ID) then
    Result := True;
end;

{ Same rules as the shipped password policy (8+ chars, upper, lower, number,
  special), so the first password is not one the app itself would refuse. }
function PasswordProblem(const Pw: string): string;
var
  I: Integer;
  C: Char;
  HasUpper, HasLower, HasDigit, HasSpecial: Boolean;
begin
  Result := '';
  HasUpper := False; HasLower := False; HasDigit := False; HasSpecial := False;
  for I := 1 to Length(Pw) do
  begin
    C := Pw[I];
    if (C >= 'A') and (C <= 'Z') then HasUpper := True
    else if (C >= 'a') and (C <= 'z') then HasLower := True
    else if (C >= '0') and (C <= '9') then HasDigit := True
    else if C <> ' ' then HasSpecial := True;
  end;
  if Length(Pw) < 8 then Result := 'at least 8 characters'
  else if not HasUpper then Result := 'an upper-case letter'
  else if not HasLower then Result := 'a lower-case letter'
  else if not HasDigit then Result := 'a number'
  else if not HasSpecial then Result := 'a special character';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Problem: string;
begin
  Result := True;
  if (not IsUpgradeFlag) and (CurPageID = AdminPage.ID) then
  begin
    Problem := PasswordProblem(AdminPage.Values[0]);
    if Problem <> '' then
    begin
      MsgBox('The password needs ' + Problem + '.', mbError, MB_OK);
      Result := False;
    end
    else if AdminPage.Values[0] <> AdminPage.Values[1] then
    begin
      MsgBox('The two passwords do not match.', mbError, MB_OK);
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

{ Runs BEFORE the [Files] copy. Three jobs, in order:
  (0) refuse to "upgrade" a first install that never finished its database,
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

  { 0. A first install that stopped before its database was complete leaves
       digilog.env behind, so this run would be taken as an UPGRADE: upgrade.ps1
       would either stop ("no initialised DB cluster") or seed the unfinished
       database with a random superadmin password nobody knows. Refuse instead. }
  if IsUpgradeFlag and FileExists(IncompleteFirstInstallMarker) then
  begin
    Result := 'An earlier FMS installation on this computer stopped before its database was set up, ' +
              'so it cannot be upgraded or repaired.' + #13#10#13#10 +
              'Its record is in ' + ExpandConstant('{commonappdata}\DigiLog\logs') + ' (install-*.log). ' +
              'Copy that file somewhere safe. Then uninstall FMS, delete the folder ' +
              ExpandConstant('{commonappdata}\DigiLog') + ' and run Setup again.' + #13#10#13#10 +
              'If FMS has been used on this computer, delete nothing and contact Controlytics support.';
    Exit;
  end;

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
                'The FMS database (bundled PostgreSQL) requires it. Install VC_redist.x64.exe ' +
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

{ After the files are copied: write the browser shortcut target, then run the
  install or upgrade orchestrator (run-setup-script.iss: logged, exit code checked).
  -ExecutionPolicy Bypass (added there) is required because the bundled scripts are
  unsigned; Setup already runs elevated and the scripts sit read-only in the
  program folder. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  UrlPath, Title: string;
begin
  if CurStep = ssPostInstall then
  begin
    UrlPath := ExpandConstant('{app}\DigiLog.url');
    { Only when missing: apply-addresses.ps1 keeps it on the port from
      digilog-addresses.ini, and rewriting it here on every upgrade would
      point it back at 3000 after the port was changed. }
    if not FileExists(UrlPath) then
      SaveStringToFile(UrlPath, '[InternetShortcut]' + #13#10 + 'URL=https://localhost:3000' + #13#10, False);

    if IsUpgradeFlag then
    begin
      { UPGRADE: pre-upgrade DB backup, forward-only migrate deploy, reseed, restart
        API. Preserves all data + secrets in C:\ProgramData\DigiLog. }
      Title := 'The FMS {#AppVersion} upgrade';
      if not RunSetupScript(Title, ExpandConstant('{app}\scripts\upgrade.ps1'),
               '-InstallDir "' + ExpandConstant('{app}') + '" -Version "{#AppVersion}"', 'upgrade',
               'Backing up and upgrading the FMS database (this can take a minute)...', '') then
        ReportSetupScriptFailure(Title,
          'The upgrade backs up the database (' + ExpandConstant('{commonappdata}\DigiLog\backups') +
          '\pre-upgrade-*.sql) before it changes anything, and stops before any change if that backup ' +
          'fails. A ROLLBACK line above names the backup to restore if the database was changed. ' +
          'Send the log file below to Controlytics support before using FMS again.');
    end
    else
    begin
      { FRESH install: generate secrets, provision Postgres, register services,
        health check. The password goes in an environment variable, never on the
        command line (run-setup-script.iss). }
      Title := 'The FMS {#AppVersion} installation';
      if not RunSetupScript(Title, ExpandConstant('{app}\scripts\install.ps1'),
               '-InstallDir "' + ExpandConstant('{app}') + '"', 'install',
               'Setting up the FMS database and services (this can take a minute)...',
               AdminPage.Values[0]) then
      begin
        if FileExists(IncompleteFirstInstallMarker) then
          ReportSetupScriptFailure(Title,
            'It stopped before the database was set up, so there is nothing to keep. Fix the cause ' +
            'shown above, copy the log file below somewhere safe, then uninstall FMS, delete the folder ' +
            ExpandConstant('{commonappdata}\DigiLog') + ' and run Setup again. Until that folder is ' +
            'deleted Setup refuses to run, because it would take this computer for an upgrade.')
        else if FileExists(ExpandConstant('{commonappdata}\DigiLog\config\digilog.env')) and
                FileExists(ExpandConstant('{commonappdata}\DigiLog\db\PG_VERSION')) then
          ReportSetupScriptFailure(Title,
            'The database is set up; a later step stopped (see above). Fix the cause and run this Setup ' +
            'again: it finishes the remaining steps (services, backup task, firewall, health check) ' +
            'and keeps the database and the superadmin password.')
        else
          ReportSetupScriptFailure(Title,
            'Nothing was set up yet. Fix the cause shown above and run Setup again.');
      end;
    end;
  end;
end;
