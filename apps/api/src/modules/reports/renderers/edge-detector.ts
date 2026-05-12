import * as defaultFs from 'node:fs';

interface FsLike {
  existsSync: (p: string) => boolean;
}

interface Deps {
  fs?: FsLike;
  env?: NodeJS.ProcessEnv;
}

const WIN32_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

const LINUX_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

const DARWIN_CANDIDATES = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function detectEdgePath(deps: Deps = {}): string {
  const fs: FsLike = deps.fs ?? defaultFs;
  const env = deps.env ?? process.env;

  const override = env.PUPPETEER_EXECUTABLE_PATH;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(
        `PUPPETEER_EXECUTABLE_PATH points at "${override}" but the file does not exist.`,
      );
    }
    return override;
  }

  const candidates =
    process.platform === 'win32'
      ? WIN32_CANDIDATES
      : process.platform === 'darwin'
        ? DARWIN_CANDIDATES
        : LINUX_CANDIDATES;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `No browser found for puppeteer-core. Tried: ${candidates.join(
      ', ',
    )}. Set PUPPETEER_EXECUTABLE_PATH to override.`,
  );
}
