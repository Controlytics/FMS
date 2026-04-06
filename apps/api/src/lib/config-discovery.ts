import { configRegistry } from './config-registry.js';

/**
 * Discover and register all module config definitions.
 * Called once at app startup before routes are registered.
 *
 * To add a new module's config:
 *   1. Create a config.def.ts in your module directory
 *   2. Add one import line below
 *   That's it — UI, routes, validation, and DB seeding are automatic.
 */
export async function discoverAndRegisterConfigs(): Promise<void> {
  const modules = await Promise.all([
    import('../modules/config/defs/password-policy.def.js'),
    import('../modules/config/defs/login-security.def.js'),
    import('../modules/config/defs/session.def.js'),
    import('../modules/config/defs/datetime.def.js'),
    import('../modules/config/defs/branding.def.js'),
    import('../modules/config/defs/user-id.def.js'),
    import('../modules/config/defs/pagination.def.js'),
    import('../modules/config/defs/action-reauth.def.js'),
    import('../modules/config/defs/audit-templates.def.js'),
    import('../modules/config/defs/alarm-columns.def.js'),
    import('../modules/config/defs/notification-email.def.js'),
    import('../modules/config/defs/notification-sms.def.js'),
import('../modules/config/defs/notification-telegram.def.js'),    import('../modules/config/defs/notification-slack.def.js'),
    import('../modules/config/defs/notification-rules.def.js'),
    import('../modules/config/defs/notification-logs.def.js'),
    import('../modules/config/defs/backup.def.js'),
    import('../modules/config/defs/roles.def.js'),
    import('../modules/config/defs/role-privileges.def.js'),
    import('../modules/config/defs/sidebar-config.def.js'),
    import('../modules/config/defs/field-ids.def.js'),
    import('../modules/config/defs/retention.def.js'),
    import('../modules/config/defs/help.def.js'),
    import('../modules/config/defs/uns.def.js'),
    import('../modules/config/defs/filter-cleaning-reasons.def.js'),
    import('../modules/config/defs/filter-lifecycle-states.def.js'),
    import('../modules/config/defs/filter-pm-schedule.def.js'),
    // ─── Add new module configs below this line ───
  ]);

  for (const mod of modules) {
    const defs = Object.values(mod).filter(
      (v): v is any => v && typeof v === 'object' && 'moduleKey' in v && 'moduleName' in v
    );
    for (const def of defs) {
      configRegistry.register(def);
    }
  }

  // Auto-seed defaults for any newly registered configs
  await configRegistry.seedDefaults();

  console.info(`[config-registry] ${configRegistry.size} modules registered`);
}
