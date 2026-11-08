// Faux cœur pour prévisualiser l'interface dans un navigateur (développement
// uniquement : absent de l'application compilée).
import sample from '../dev/exemple.md?raw';
import sampleHtml from '../dev/exemple.html?raw';
import type { DefaultAppStatus, DirEntry, FileData } from './api';

const DIR = 'C:\\Notes\\Démo';
const files = new Map<string, string>([[`${DIR}\\Exemple.md`, sample]]);

function data(path: string): FileData {
  const content = files.get(path) ?? '';
  const name = path.split('\\').pop() ?? path;
  return { path, name, dir: DIR, content, crlf: false, bom: false, mtime: Date.now(), readonly: false, lossy: false };
}

export async function mockCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case 'startup_files':
      return r([`${DIR}\\Exemple.md`]);
    case 'read_file':
    case 'create_file':
      return r(data(String(args.path)));
    case 'write_file':
      files.set(String(args.path), String(args.content));
      return r(Date.now());
    case 'render_markdown':
      return r(String(args.content) === sample ? sampleHtml : `<p>${String(args.content).slice(0, 2000)}</p>`);
    case 'resolve_link':
      return r(null);
    case 'list_dir':
      return r([
        { name: 'Archives', path: `${DIR}\\Archives`, isDir: true },
        { name: 'Exemple.md', path: `${DIR}\\Exemple.md`, isDir: false },
        { name: 'Journal.md', path: `${DIR}\\Journal.md`, isDir: false },
      ] satisfies DirEntry[]);
    case 'default_app_status':
      return r({ platform: 'windows', registered: false, isDefault: false } satisfies DefaultAppStatus);
    default:
      return r(null);
  }
}
