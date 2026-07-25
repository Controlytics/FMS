import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Branding {
  primaryColor: string;
  secondaryColor: string;
}

interface StepProps {
  mfaToken: string;
  password: string;
  branding: Branding;
  onCancel: () => void;
}

/** 6-digit (or backup-code) second-factor challenge for an enrolled SUPER_ADMIN. */
export function MfaChallenge({ mfaToken, password, branding, onCancel }: StepProps) {
  const { mfaVerify } = useAuth();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(false);

  const submit = async (force?: boolean) => {
    setError('');
    setLoading(true);
    try {
      await mfaVerify(mfaToken, code.trim(), password, force); // navigates on success
    } catch (err: any) {
      if (err.code === 'SESSION_CONFLICT') { setConflict(true); setLoading(false); return; }
      if (err.code === 'MFA_TOKEN_INVALID') { setError('Your login step expired. Please sign in again.'); }
      else { setError(err.message || 'Verification failed'); }
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800">Two-factor authentication</h2>
        <p className="text-sm text-slate-500 mt-1">
          {useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-medium">{error}</div>}

      {conflict ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Your account is signed in elsewhere. Continue and end that session?
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConflict(false)} disabled={loading}>Back</Button>
            <Button className="flex-1 font-semibold" onClick={() => submit(true)} disabled={loading}
              style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})` }}>
              Continue & sign out
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={useBackup ? 'xxxx-xxxx' : '000000'}
            inputMode={useBackup ? 'text' : 'numeric'}
            autoFocus
            autoComplete="one-time-code"
            className="h-12 text-center text-lg tracking-widest rounded-xl border-2 border-slate-200 bg-slate-50/50"
          />
          <Button type="submit" disabled={loading || !code.trim()}
            className="w-full h-12 text-base font-semibold rounded-xl"
            style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})` }}>
            {loading ? 'Verifying…' : 'Verify'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="font-semibold" style={{ color: branding.secondaryColor }}
              onClick={() => { setUseBackup(!useBackup); setCode(''); setError(''); }}>
              {useBackup ? 'Use authenticator code' : 'Use a backup code'}
            </button>
            <button type="button" className="text-slate-500 font-medium hover:text-slate-700" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** First-login enrolment wizard: QR + manual key → confirm code → backup codes. */
export function MfaEnroll({ mfaToken, password, branding, onCancel }: StepProps) {
  const { mfaEnrollStart, mfaEnrollVerify, postLoginNavigate } = useAuth();
  const [step, setStep] = useState<'qr' | 'backup'>('qr');
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [completedRes, setCompletedRes] = useState<any>(null);
  const [savedAck, setSavedAck] = useState(false);

  // Kick off enrolment once — fetch the secret + render the QR.
  useEffect(() => {
    let cancelled = false;
    mfaEnrollStart(mfaToken)
      .then(async ({ otpauthUri, secret }) => {
        if (cancelled) return;
        setSecret(secret);
        setQrDataUrl(await QRCode.toDataURL(otpauthUri, { margin: 1, width: 200 }));
      })
      .catch((err) => setError(err.code === 'MFA_TOKEN_INVALID' ? 'Your login step expired. Please sign in again.' : (err.message || 'Could not start enrolment')));
    return () => { cancelled = true; };
  }, [mfaToken, mfaEnrollStart]);

  const confirm = async (force?: boolean) => {
    setError('');
    setLoading(true);
    try {
      const res = await mfaEnrollVerify(mfaToken, code.trim(), password, force);
      setBackupCodes(res.backupCodes ?? []);
      setCompletedRes(res);
      setStep('backup');
    } catch (err: any) {
      if (err.code === 'SESSION_CONFLICT') { await confirm(true); return; }
      setError(err.code === 'MFA_TOKEN_INVALID' ? 'Your login step expired. Please sign in again.' : (err.message || 'Incorrect code'));
    } finally {
      setLoading(false);
    }
  };

  const downloadCodes = () => {
    const blob = new Blob([`DigiLog SUPER_ADMIN MFA backup codes\nGenerated: ${new Date().toISOString()}\n\n${backupCodes.join('\n')}\n\nEach code works once. Store securely offline.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'digilog-mfa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (step === 'backup') {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800">Save your backup codes</h2>
          <p className="text-sm text-slate-500 mt-1">Each code works once if you lose your authenticator. They won't be shown again.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 border border-slate-200 p-4 font-mono text-sm">
          {backupCodes.map((c) => <div key={c} className="text-slate-800 tracking-wider">{c}</div>)}
        </div>
        <Button variant="outline" className="w-full" onClick={downloadCodes}>Download .txt</Button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={savedAck} onChange={(e) => setSavedAck(e.target.checked)} />
          I have saved these backup codes.
        </label>
        <Button disabled={!savedAck} className="w-full h-12 text-base font-semibold rounded-xl"
          style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})` }}
          onClick={() => postLoginNavigate(completedRes)}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800">Set up two-factor authentication</h2>
        <p className="text-sm text-slate-500 mt-1">Scan the QR code with an authenticator app (Google Authenticator, Authy, …), then enter the code it shows.</p>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-medium">{error}</div>}

      <div className="flex flex-col items-center gap-3">
        {qrDataUrl
          ? <img src={qrDataUrl} alt="MFA QR code" className="rounded-xl border border-slate-200" width={200} height={200} />
          : <div className="w-[200px] h-[200px] rounded-xl bg-slate-100 animate-pulse" />}
        {secret && (
          <div className="text-center">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Or enter this key manually</p>
            <p className="font-mono text-sm text-slate-700 break-all mt-1">{secret}</p>
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="space-y-3">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric"
          autoComplete="one-time-code"
          className="h-12 text-center text-lg tracking-widest rounded-xl border-2 border-slate-200 bg-slate-50/50" />
        <Button type="submit" disabled={loading || !code.trim() || !secret}
          className="w-full h-12 text-base font-semibold rounded-xl"
          style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})` }}>
          {loading ? 'Verifying…' : 'Verify & enable'}
        </Button>
        <div className="text-center">
          <button type="button" className="text-sm text-slate-500 font-medium hover:text-slate-700" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
