import dayjs from 'dayjs';

export interface ResolutionContext {
  entitySlots: Record<string, string>;
  timeRange: { start: Date; end: Date };
  orgId: string;
  userId: string;
  userName: string;
  orgName: string;
  reportName: string;
  templateName: string;
}

export interface ResolvedValue {
  value: unknown;
  error?: string;
}

export function resolveTimestamp(path: string, ctx: ResolutionContext): ResolvedValue {
  switch (path) {
    case 'now':
      return { value: dayjs().format('DD/MM/YYYY HH:mm:ss') };
    case 'range.start':
      return { value: ctx.timeRange.start ? dayjs(ctx.timeRange.start).format('DD/MM/YYYY HH:mm') : '' };
    case 'range.end':
      return { value: ctx.timeRange.end ? dayjs(ctx.timeRange.end).format('DD/MM/YYYY HH:mm') : '' };
    default:
      return { value: '', error: `Unknown timestamp path: ${path}` };
  }
}
