// Petits outils de chemins, valables pour Windows (\) comme pour macOS (/).
import { platform } from './api';

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return path;
  if (i === 0) return path.slice(0, 1);
  const dir = path.slice(0, i);
  return /^[A-Za-z]:$/.test(dir) ? dir + '\\' : dir;
}

/** Nom sans l'extension Markdown, comme dans les onglets d'Obsidian. */
export function stem(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd|mkdn|mdx)$/i, '');
}

export function join(dir: string, name: string): string {
  const sep = dir.includes('\\') || platform === 'windows' ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

function norm(path: string): string {
  const p = path.replace(/[\\/]+$/, '');
  return platform === 'linux' ? p : p.toLowerCase().replace(/\//g, '\\');
}

export function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

export function isInside(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + (platform === 'linux' ? '/' : '\\'));
}

export const NOTE_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i;
