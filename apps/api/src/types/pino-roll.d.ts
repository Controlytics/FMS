/**
 * pino-roll@4 ships no type declarations (`package.json` has no `types` field),
 * so TypeScript would refuse the import. This declares exactly the surface we
 * use, transcribed from the package's own JSDoc in `pino-roll.js`.
 *
 * Deliberately NOT `any` — the option names are the whole risk here (a typo in
 * `dateFormat` or `frequency` silently changes the file naming, and the
 * retention sweep in lib/log-retention.ts matches on that naming).
 */
declare module 'pino-roll' {
  import type SonicBoom from 'sonic-boom';

  interface PinoRollLimit {
    /** Files to keep IN ADDITION to the active one. We do not use this — see lib/log-retention.ts. */
    count?: number;
    removeOtherLogFiles?: boolean;
  }

  interface PinoRollOptions {
    /** Base path; pino-roll appends `.<date>.<n><extension>`. */
    file: string | (() => string);
    /** 'k' | 'm' | 'g' suffix; a bare number is MB. */
    size?: string | number;
    /** 'daily' | 'hourly' | milliseconds. */
    frequency?: 'daily' | 'hourly' | number;
    /** Appended after the file number, e.g. '.log'. */
    extension?: string;
    /** date-fns format appended to the base name, e.g. 'yyyy-MM-dd'. */
    dateFormat?: string;
    symlink?: boolean;
    limit?: PinoRollLimit;
    /** SonicBoom passthrough. */
    mkdir?: boolean;
    sync?: boolean;
    append?: boolean;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<SonicBoom>;
}
