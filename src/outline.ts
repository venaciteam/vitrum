// Plan du document (panneau de droite), calculé à partir du source.
import { el } from './ui';

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Titres `#` du source, hors front matter, blocs de code et commentaires `%%`. */
export function headingsOf(text: string): Heading[] {
  const lines = text.split('\n');
  const out: Heading[] = [];
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  let comment = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    if (/^\s*%%/.test(line) && (line.match(/%%/g)?.length ?? 0) % 2 === 1) comment = !comment;
    if (comment) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[2]) out.push({ level: m[1].length, text: clean(m[2]), line: i + 1 });
  }
  return out;
}

function clean(s: string): string {
  return s
    .replace(/%%.*?%%/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](\s|$)/g, '$1$2')
    .trim();
}

export class Outline {
  readonly dom: HTMLElement;
  private list: HTMLElement;
  private onSelect: (line: number) => void = () => {};

  constructor() {
    this.dom = el('div', 'outline-view');
    this.list = el('div', 'outline-list');
    this.dom.append(this.list);
  }

  setHandler(fn: (line: number) => void): void {
    this.onSelect = fn;
  }

  update(headings: Heading[] | null): void {
    this.list.replaceChildren();
    if (!headings) {
      this.list.append(el('div', 'pane-empty', 'Aucun fichier ouvert.'));
      return;
    }
    if (!headings.length) {
      this.list.append(el('div', 'pane-empty', 'Aucun titre dans ce document.'));
      return;
    }
    const min = Math.min(...headings.map((h) => h.level));
    for (const h of headings) {
      const item = el('div', 'tree-item-self outline-item', h.text || '(sans titre)');
      item.style.paddingInlineStart = `${12 + (h.level - min) * 16}px`;
      item.dataset.level = String(h.level);
      item.title = h.text;
      item.addEventListener('click', () => this.onSelect(h.line));
      this.list.append(item);
    }
  }
}
