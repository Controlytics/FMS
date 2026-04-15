import type { ResolutionContext, ResolvedValue } from './timestamp-source.js';

export function resolveMeta(path: string, ctx: ResolutionContext): ResolvedValue {
  switch (path) {
    case 'report.name':
      return { value: ctx.reportName };
    case 'user.name':
      return { value: ctx.userName };
    case 'org.name':
      return { value: ctx.orgName };
    case 'template.name':
      return { value: ctx.templateName };
    default:
      return { value: '', error: `Unknown meta path: ${path}` };
  }
}
