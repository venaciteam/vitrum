// Accès au cœur Rust (commandes Tauri). Hors de Tauri (aperçu dans un
// navigateur pendant le développement), un faux cœur prend le relais.
import { invoke } from '@tauri-apps/api/core';

export const isTauri = '__TAURI_INTERNALS__' in window;

export const platform: 'windows' | 'macos' | 'linux' = /Mac/i.test(navigator.userAgent)
  ? 'macos'
  : /Windows/i.test(navigator.userAgent)
    ? 'windows'
    : 'linux';

export const modKey = platform === 'macos' ? '⌘' : 'Ctrl+';

export interface FileData {
  path: string;
  name: string;
  dir: string;
  content: string;
  crlf: boolean;
  bom: boolean;
  mtime: number;
  readonly: boolean;
  lossy: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface DefaultAppStatus {
  platform: string;
  registered: boolean;
  isDefault: boolean;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  if (import.meta.env.DEV) {
    const { mockCall } = await import('./mock');
    return mockCall<T>(cmd, args);
  }
  throw new Error('Vitrum doit être lancé comme application.');
}

export const api = {
  startupFiles: () => call<string[]>('startup_files'),
  readFile: (path: string) => call<FileData>('read_file', { path }),
  writeFile: (path: string, content: string, crlf: boolean, bom: boolean) =>
    call<number>('write_file', { path, content, crlf, bom }),
  createFile: (path: string) => call<FileData>('create_file', { path }),
  forgetFile: (path: string) => call<void>('forget_file', { path }),
  render: (path: string | null, content: string, strictLineBreaks: boolean) =>
    call<string>('render_markdown', { path, content, strictLineBreaks }),
  resolveLink: (from: string | null, href: string) => call<string | null>('resolve_link', { from, href }),
  listDir: (path: string) => call<DirEntry[]>('list_dir', { path }),
  defaultAppStatus: () => call<DefaultAppStatus>('default_app_status'),
  openDefaultAppSettings: () => call<void>('open_default_app_settings'),
};

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
