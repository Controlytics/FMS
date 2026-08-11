import useSWR from 'swr';
import { BACKUP_FORMATS, BACKUP_FORMAT_DEFAULT, type BackupFormatValue } from '@digilog/shared';

/**
 * The configured DEFAULT backup file format (`backup-format` config,
 * `GET /api/config/backup-format/current`, readable by every authenticated
 * user — BACKUP_EXPORT does not imply CONFIG_READ).
 *
 * This is a default, not a lock: the Backup & Restore page preselects it and
 * the operator may still pick another format for a given export.
 *
 * `isLoading` matters to the caller: the page must not seed its radio selection
 * until the real value arrives, or a fast click would export in the built-in
 * fallback format while the configured one is still in flight.
 */
export function useBackupFormat(): { defaultFormat: BackupFormatValue; isLoading: boolean } {
  const { data, isLoading } = useSWR<{ defaultFormat?: string }>(
    '/api/config/backup-format/current',
    { revalidateOnMount: true, dedupingInterval: 5000, revalidateOnFocus: false },
  );
  // Guard the stored value: a config row written before an option was retired
  // (or hand-edited in the DB) must not put the page into a format the restore
  // path can't read back.
  const stored = data?.defaultFormat;
  const defaultFormat = BACKUP_FORMATS.includes(stored as BackupFormatValue)
    ? (stored as BackupFormatValue)
    : BACKUP_FORMAT_DEFAULT;
  return { defaultFormat, isLoading };
}
