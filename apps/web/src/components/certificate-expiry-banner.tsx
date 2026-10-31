import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

interface CertificateStatus {
  certificate: { subject: string; validTo: string; daysLeft: number } | null;
  warnDays: number;
  warning: boolean;
}

/**
 * Super Admin warning before the server's HTTPS certificate expires (2026-10-31,
 * `GET /api/system-health/certificate`, SUPER_ADMIN-only like this banner). A
 * company certificate renewed every two months that nobody swaps in time stops
 * every browser and tablet the day it expires. The FMS's own certificate lasts
 * 10 years, so on most installs this never renders.
 */
export function CertificateExpiryBanner() {
  const { user } = useAuth();
  const { formatDate } = useDatetimeFormat();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const { data } = useSWR<CertificateStatus>(isSuperAdmin ? '/api/system-health/certificate' : null, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 60 * 1000,
  });
  if (!isSuperAdmin || !data?.warning || !data.certificate) return null;

  const { daysLeft, validTo } = data.certificate;
  const expired = daysLeft < 0;
  return (
    <div
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm ${expired ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
    >
      <p className="font-semibold">
        {expired
          ? `The server's HTTPS certificate expired on ${formatDate(validTo)}.`
          : `The server's HTTPS certificate expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`} (${formatDate(validTo)}).`}
      </p>
      <p className="mt-1">
        {expired
          ? 'Browsers and tablets refuse the server until it is replaced. '
          : 'When it expires, browsers and tablets can no longer connect. '}
        Ask IT for the renewed certificate, then on the FMS server PC open Start menu → FMS → Change SSL certificate.
      </p>
    </div>
  );
}
