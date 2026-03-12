/**
 * Template Engine — Resolves dynamic variables in notification templates.
 * Supports ${variable} syntax with nested dot notation.
 */

const VARIABLE_REGEX = /\$\{([^}]+)\}/g;

/**
 * Resolve all ${variable} placeholders in a template string.
 */
export function resolveTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(VARIABLE_REGEX, (match, key: string) => {
    const value = variables[key.trim()];
    return value !== undefined ? value : match;
  });
}

/**
 * Extract all variable names from a template string.
 */
export function extractVariables(template: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(VARIABLE_REGEX);
  while ((match = regex.exec(template)) !== null) {
    vars.push(match[1].trim());
  }
  return [...new Set(vars)];
}

/**
 * Build standard alarm variables from alarm data.
 */
export function buildAlarmVariables(alarm: Record<string, unknown>): Record<string, string> {
  return {
    alarmType: String(alarm.alarmType ?? alarm.type ?? ''),
    alarmSeverity: String(alarm.severity ?? ''),
    deviceName: String(alarm.entityName ?? alarm.deviceName ?? ''),
    entityName: String(alarm.entityName ?? ''),
    entityId: String(alarm.entityId ?? ''),
    timestamp: String(alarm.timestamp ?? new Date().toISOString()),
    description: String(alarm.description ?? alarm.details ?? ''),
    status: String(alarm.status ?? ''),
  };
}

/**
 * Build standard rule chain variables from context.
 */
export function buildRuleChainVariables(
  message: Record<string, unknown>,
  ctx: { entityName?: string; entityId?: string; unsPath?: string },
): Record<string, string> {
  const vars: Record<string, string> = {
    entityName: ctx.entityName ?? '',
    entityId: ctx.entityId ?? '',
    unsPath: ctx.unsPath ?? '',
    messageJson: JSON.stringify(message),
    timestamp: new Date().toISOString(),
  };
  // Flatten top-level message keys as msg.key
  for (const [k, v] of Object.entries(message)) {
    vars[`msg.${k}`] = String(v ?? '');
  }
  return vars;
}
