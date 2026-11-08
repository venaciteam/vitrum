// Recherche dans la vue de lecture (Ctrl+F), surlignage via l'API CSS Highlight.
import { iconButton } from './ui';
import { el } from './ui';
import { scrollToElement } from './reader';

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

export class FindBar {
  readonly dom: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private ranges: Range[] = [];
  private index = -1;

  constructor(
    private root: () => HTMLElement,
    private scroller: () => HTMLElement,
  ) {
    this.dom = el('div', 'document-search-container is-hidden');
    this.input = el('input', 'document-search-input');
    this.input.type = 'search';
    this.input.placeholder = 'Rechercher…';
    this.input.spellcheck = false;
    this.count = el('div', 'document-search-count');
    const prev = iconButton('chevron-up', 'Précédent (Maj+Entrée)', () => this.step(-1));
    const next = iconButton('chevron-down', 'Suivant (Entrée)', () => this.step(1));
    const close = iconButton('x', 'Fermer (Échap)', () => this.close());
    this.dom.append(this.input, this.count, prev, next, close);
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.dom.classList.contains('is-hidden');
  }

  open(): void {
    const selected = window.getSelection()?.toString().trim();
    if (selected && !selected.includes('\n')) this.input.value = selected;
    this.dom.classList.remove('is-hidden');
    this.input.focus();
    this.input.select();
    this.search();
  }

  close(): void {
    this.dom.classList.add('is-hidden');
    this.clear();
  }

  /** Après un nouveau rendu, les anciennes plages ne sont plus valides. */
  refresh(): void {
    if (this.isOpen) this.search();
  }

  private clear(): void {
    this.ranges = [];
    this.index = -1;
    this.count.textContent = '';
    if (supported) {
      CSS.highlights.delete('vitrum-find');
      CSS.highlights.delete('vitrum-find-current');
    }
  }

  private search(): void {
    this.clear();
    const query = this.input.value;
    if (!query) return;
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    // Ignore le texte invisible : styles des diagrammes, MathML de KaTeX, callouts repliés.
    const walker = document.createTreeWalker(this.root(), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest('style, script, .katex-mathml, .copy-code-button, .callout.is-collapsed > .callout-content')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      for (const m of text.matchAll(pattern)) {
        const r = new Range();
        r.setStart(node, m.index ?? 0);
        r.setEnd(node, (m.index ?? 0) + m[0].length);
        this.ranges.push(r);
      }
    }
    if (supported && this.ranges.length) CSS.highlights.set('vitrum-find', new Highlight(...this.ranges));
    this.index = this.ranges.length ? 0 : -1;
    this.show();
  }

  private step(delta: number): void {
    if (!this.ranges.length) return;
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.show();
  }

  private show(): void {
    this.count.textContent = this.ranges.length ? `${this.index + 1} / ${this.ranges.length}` : 'Aucun résultat';
    this.dom.classList.toggle('is-empty', !this.ranges.length && !!this.input.value);
    const range = this.ranges[this.index];
    if (!range) return;
    if (supported) CSS.highlights.set('vitrum-find-current', new Highlight(range));
    const holder = range.startContainer.parentElement;
    if (holder) {
      const r = range.getBoundingClientRect();
      const box = this.scroller().getBoundingClientRect();
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) {
        scrollToElement(this.scroller(), holder, box.height / 3);
      }
    }
  }
}
