; FMS - run install.ps1 / upgrade.ps1 so that a failure is SEEN and LOGGED.
;
; #included by DigiLog.iss, and by installer\test\run-setup-script-harness.iss,
; which proves this exact code without installing FMS (test-installer-run-script.ps1).
;
; Before 1.2.3 (rebuilt 2026-10-23) the two scripts were [Run] entries with
; Flags: runhidden. Inno Setup does not look at a [Run] program's exit code, and
; the window was hidden, so a failed install or upgrade still ended on the normal
; Finish page and every FATAL: line was lost (report 10 section 5). [Run] also
; writes its command line into Setup's own log, and the fresh-install line carried
; the superadmin password. Now:
;   - the script's output, stdout AND stderr, goes line by line into
;     <SetupDataRoot>\logs\<prefix>-<yyyymmdd-hhnnss>.log (ExecAndLogOutput), so a
;     native program's error text - Prisma, pg_dump, node - is kept too;
;   - a non-zero exit code shows a message box, rewrites the Finish page and makes
;     Setup exit with SetupScriptFailedExitCode, so a silent install fails too;
;   - a secret is handed over in an environment variable of Setup's own process
;     (SetupScriptSecretEnv), which the child inherits; it is never on a command line.

[Code]
const
  { Setup's own exit codes are 0-8 (help topic "Setup Exit Codes"). }
  SetupScriptFailedExitCode = 10;
  SetupScriptMaxProblemLines = 6;
  { The variable install.ps1 reads the superadmin password from. }
  SetupScriptSecretEnv = 'FMS_SETUP_ADMIN_PASSWORD';

var
  { Set by the including script before any call: the data root
    (C:\ProgramData\DigiLog for FMS). Logs go to <SetupDataRoot>\logs. }
  SetupDataRoot: String;
  SetupScriptLogPath: String;
  SetupScriptProblems: String;
  SetupScriptProblemCount: Integer;
  SetupScriptWarnings: String;
  SetupScriptFailed: Boolean;
  SetupScriptFinishText: String;

function SetProcessEnvironmentVariable(lpName, lpValue: String): Integer;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

procedure SetupScriptAppendLog(const S: String);
begin
  SaveStringToFile(SetupScriptLogPath, S + #13#10, True);
end;

{ The prefixes the scripts print (Write-Host "FATAL: ...", etc.) plus the
  'ERROR:' / 'Error:' lines PostgreSQL and Prisma print when a migration stops.
  Case-sensitive on purpose: Prisma's own lower-case 'warn' notices are not ours. }
function SetupScriptIsProblem(const T: String): Boolean;
begin
  Result := (Pos('FATAL:', T) = 1) or (Pos('FAILED', T) = 1) or (Pos('ROLLBACK:', T) = 1) or
            (Pos('ERROR:', T) = 1) or (Pos('Error:', T) = 1) or
            (Pos('WARN:', T) = 1) or (Pos('WARNING:', T) = 1);
end;

function SetupScriptIsWarning(const T: String): Boolean;
begin
  Result := (Pos('WARN:', T) = 1) or (Pos('WARNING:', T) = 1);
end;

{ ExecAndLogOutput callback: one call per line the script prints. }
procedure SetupScriptOnLog(const S: String; const Error, FirstLine: Boolean);
var
  T: String;
begin
  if Error then
  begin
    SetupScriptAppendLog('[Setup could not read more output: ' + S + ']');
    Exit;
  end;
  SetupScriptAppendLog(S);
  T := Trim(S);
  if T = '' then Exit;
  { Live progress under the status line, e.g. "==> prisma migrate deploy". }
  if Length(T) > 110 then
    WizardForm.FilenameLabel.Caption := Copy(T, 1, 107) + '...'
  else
    WizardForm.FilenameLabel.Caption := T;
  if SetupScriptIsProblem(T) and (SetupScriptProblemCount < SetupScriptMaxProblemLines) then
  begin
    if Length(T) > 300 then T := Copy(T, 1, 297) + '...';
    SetupScriptProblems := SetupScriptProblems + T + #13#10;
    SetupScriptProblemCount := SetupScriptProblemCount + 1;
    if SetupScriptIsWarning(T) then
      SetupScriptWarnings := SetupScriptWarnings + T + #13#10;
  end;
end;

{ Runs <ScriptPath> with powershell.exe, logs everything it prints, and returns
  True only when it exits 0. Secret (may be '') is put in SetupScriptSecretEnv
  for the duration of the run and cleared afterwards. On False the caller works
  out what the operator should do and calls ReportSetupScriptFailure. }
function RunSetupScript(const Title, ScriptPath, ScriptParams, LogPrefix, StatusText, Secret: String): Boolean;
var
  ResultCode: Integer;
  Started: Boolean;
  Params, StartError: String;
begin
  Result := False;
  ResultCode := 0;
  StartError := '';
  SetupScriptProblems := '';
  SetupScriptProblemCount := 0;
  SetupScriptWarnings := '';

  ForceDirectories(AddBackslash(SetupDataRoot) + 'logs');
  SetupScriptLogPath := AddBackslash(SetupDataRoot) + 'logs\' + LogPrefix + '-' +
                        GetDateTimeString('yyyymmdd-hhnnss', #0, #0) + '.log';
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '" ' + ScriptParams;

  SetupScriptAppendLog('=== ' + Title + ' ===');
  SetupScriptAppendLog('Started: ' + GetDateTimeString('yyyy/mm/dd hh:nn:ss', '-', ':'));
  SetupScriptAppendLog('Command: powershell.exe ' + Params);
  if Secret <> '' then
    SetupScriptAppendLog('(the superadmin password is passed in an environment variable and is not recorded)');
  SetupScriptAppendLog('');
  Log('Running ' + ScriptPath + '; output is logged to ' + SetupScriptLogPath);

  WizardForm.StatusLabel.Caption := StatusText;
  WizardForm.FilenameLabel.Caption := '';

  if Secret <> '' then SetProcessEnvironmentVariable(SetupScriptSecretEnv, Secret);
  try
    try
      Started := ExecAndLogOutput('powershell.exe', Params, '', SW_SHOWNORMAL,
                                  ewWaitUntilTerminated, ResultCode, @SetupScriptOnLog);
    except
      Started := False;
      StartError := GetExceptionMessage;
    end;
  finally
    if Secret <> '' then SetProcessEnvironmentVariable(SetupScriptSecretEnv, '');
  end;

  SetupScriptAppendLog('');
  if not Started then
  begin
    if StartError = '' then StartError := SysErrorMessage(ResultCode);
    SetupScriptAppendLog('Setup could not run powershell.exe: ' + StartError);
    SetupScriptProblems := 'Setup could not run powershell.exe: ' + StartError + #13#10;
  end
  else
  begin
    SetupScriptAppendLog('Exit code: ' + IntToStr(ResultCode));
    Result := ResultCode = 0;
  end;
  if Result then
    SetupScriptAppendLog('Finished: ' + GetDateTimeString('yyyy/mm/dd hh:nn:ss', '-', ':') + ' - OK')
  else
    SetupScriptAppendLog('Finished: ' + GetDateTimeString('yyyy/mm/dd hh:nn:ss', '-', ':') + ' - FAILED');
  Log(ScriptPath + ' finished with exit code ' + IntToStr(ResultCode) + '; log: ' + SetupScriptLogPath);

  WizardForm.FilenameLabel.Caption := '';
  if not Result then
  begin
    if SetupScriptProblems = '' then
      SetupScriptProblems := 'The script stopped with exit code ' + IntToStr(ResultCode) +
                             ' and printed no FATAL / FAILED line.' + #13#10;
    Exit;
  end;
  { Exit 0 with warnings (e.g. the nightly backup task could not be registered)
    is a finished install, but not one to sign off unseen. }
  if SetupScriptWarnings <> '' then
    SuppressibleMsgBox(Title + ' finished with warnings:' + #13#10#13#10 + SetupScriptWarnings + #13#10 +
                       'The full record is in:' + #13#10 + SetupScriptLogPath, mbInformation, MB_OK, IDOK);
end;

{ After RunSetupScript returned False: message box (suppressible), Finish page
  text and Setup's exit code. Advice = what the operator should do now. }
procedure ReportSetupScriptFailure(const Title, Advice: String);
begin
  SetupScriptFailed := True;
  SetupScriptFinishText := Title + ' did NOT finish.' + #13#10#13#10 + Advice + #13#10#13#10 +
                           'The full record is in:' + #13#10 + SetupScriptLogPath;
  SuppressibleMsgBox(Title + ' did NOT finish.' + #13#10#13#10 + SetupScriptProblems + #13#10 + Advice + #13#10#13#10 +
                     'The full record is in:' + #13#10 + SetupScriptLogPath, mbCriticalError, MB_OK, IDOK);
end;

<event('CurPageChanged')>
procedure SetupScriptFinishedPage(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and SetupScriptFailed then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Setup did not finish';
    WizardForm.FinishedLabel.Caption := SetupScriptFinishText;
    WizardForm.AdjustLabelHeight(WizardForm.FinishedLabel);
  end;
end;

<event('GetCustomSetupExitCode')>
function SetupScriptExitCode: Integer;
begin
  Result := 0;
  if SetupScriptFailed then Result := SetupScriptFailedExitCode;
end;
