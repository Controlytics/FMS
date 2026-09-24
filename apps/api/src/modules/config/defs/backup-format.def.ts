import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';
import { BACKUP_FORMAT_DEFAULT } from '@digilog/shared';

/**
 * Default file format for database backups, kept as its OWN config surface
 * rather than folded into `backup.def` — that def is a link-card for the
 * custom Backup & Restore page (`settings: []`, `hasCustomPage: true`), so a
 * setting added there would never render.
 *
 * Only the two RESTORABLE formats are offered. SQL and CSV exports exist on the
 * Backup & Restore page for analysis and out-of-band (psql) recovery, but
 * `POST /api/backup/restore` cannot take them back in — making one of those the
 * standing default would quietly produce a shelf of backups that the
 * application can never restore, which is the opposite of what a backup policy
 * is for. Operators can still pick them ad hoc on the page.
 *
 * This is a DEFAULT, not a lock: the Backup & Restore page preselects it and
 * the operator may still choose another format for a given export.
 */
export const backupFormatDef: ModuleConfigDefinition = {
  moduleKey: 'backup-format',
  moduleName: 'Backup Format',
  description: 'Default file format preselected on the Backup & Restore page when creating a backup.',
  icon: 'database',
  category: 'advanced',
  sortOrder: 51,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    {
      key: 'defaultFormat',
      type: 'select',
      label: 'Default Backup Format',
      description:
        'Preselected on the Backup & Restore page. DUMP is the recommended default: a pg_dump custom archive carrying the SCHEMA as well as the data, so it can rebuild the database from nothing — and the only format pgAdmin\'s Restore dialog accepts. JSON and BAK are data-only (they need an already-migrated database) and restore in-app; BAK is the same content gzip-compressed. SQL and CSV remain available ad hoc on the page.',
      group: 'Backup Format',
      default: BACKUP_FORMAT_DEFAULT,
      options: [
        { value: 'dump', label: 'DUMP — full schema + data via pg_dump (recommended; pgAdmin-restorable)' },
        { value: 'json', label: 'JSON — data only, human-readable, with checksum' },
        { value: 'bak', label: 'BAK — data only, compressed, smallest file' },
      ],
    },
  ],
};
