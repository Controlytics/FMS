; Test harness for installer\run-setup-script.iss - the code FMS Setup uses to run
; install.ps1 / upgrade.ps1. It installs nothing of FMS: it copies
; fake-setup-script.ps1 into /DIR and runs it through the SAME RunSetupScript /
; ReportSetupScriptFailure code, as an ordinary user (no admin, no services, no
; ProgramData). Driven by test-run-setup-script.ps1, which compiles it with
;   /DTestSecret=<value>  the fake password handed over (compiled in, so it is not
;                         on Setup's command line, which Setup logs)
;   /DOutDir=<dir>        where the harness exe is written
; and runs it with /DIR=<dir> /DataRoot=<dir> /Mode=ok|warn|fail.

#ifndef TestSecret
  #define TestSecret "harness-secret"
#endif
#ifndef OutDir
  #define OutDir "Output"
#endif

[Setup]
AppId={{6E0C4D52-7A1B-4C3E-9F20-FMSHARNESS01}
AppName=FMS setup-script harness
AppVersion=0.0.0
DefaultDirName={localappdata}\fms-setup-script-harness
OutputDir={#OutDir}
OutputBaseFilename=run-setup-script-harness
PrivilegesRequired=lowest
; Same as DigiLog.iss, so powershell.exe resolves to the same (64-bit) binary.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Uninstallable=no
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
SetupLogging=yes
WizardStyle=modern

[Files]
Source: "fake-setup-script.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

#include "..\run-setup-script.iss"

[Code]
procedure InitializeWizard;
begin
  SetupDataRoot := ExpandConstant('{param:DataRoot|}');
  if SetupDataRoot = '' then SetupDataRoot := ExpandConstant('{app}\data');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Title: String;
begin
  if CurStep = ssPostInstall then
  begin
    Title := 'The harness run';
    ForceDirectories(SetupDataRoot);
    if not RunSetupScript(Title, ExpandConstant('{app}\scripts\fake-setup-script.ps1'),
             '-Mode "' + ExpandConstant('{param:Mode|ok}') + '" -DataRoot "' + SetupDataRoot + '"',
             'install', 'Running the harness script...', '{#TestSecret}') then
      ReportSetupScriptFailure(Title, 'Harness advice paragraph.');
  end;
end;
