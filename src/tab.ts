// Un onglet : un fichier, sa vue de lecture et son éditeur.
import type { EditorView } from '@codemirror/view';
import { api, errorMessage, modKey, type FileData } from './api';
import {
  applyDiskText,
  createEditor,
  openSearch,
  refreshSpellcheck,
  resetEditor,
  editorLineAtY,
  scrollEditorLineTo,
  scrollToLine as editorScrollToLine,
  setReadonly,
} from './editor';
import { FindBar } from './find';
import { setIcon } from './icons';
import { headingsOf } from './outline';
import { basename, dirname, stem } from './paths';
import { elementForLine, enhance, findHeading, lineAtY, scrollToElement, yForLine } from './reader';
import { settings, type Mode } from './settings';
import { el, notice } from './ui';

export interface TabHost {
  onTabChanged(tab: Tab): void;
  openLink(tab: Tab, link: { path?: string; href: string }, newTab: boolean): void;
  openExternal(url: string): void;
  showViewMenu(tab: Tab, anchor: HTMLElement): void;
  revealFolder(dir: string): void;
  closeTab(tab: Tab): void;
  buildEmptyState(container: HTMLElement): void;
}

let nextId = 1;

/**
 * Ce qui est affiché à une hauteur donnée de la vue : la ligne du source
 * (fractionnaire) et sa distance au haut de la zone de défilement. Sert à
 * garder le même texte sous les yeux en changeant de mode ou de zoom.
 */
export interface ScrollAnchor {
  line: number;
  offset: number;
  /** Vue tout en haut : y rester. */
  atTop: boolean;
}

const AUTOSAVE_DELAY = 1000;

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function stripFrontMatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export class Tab {
  readonly id = nextId++;
  file: FileData | null = null;
  mode: Mode = settings.defaultMode;
  dirty = false;
  missing = false;
  stats = { words: 0, chars: 0 };

  readonly dom: HTMLElement;
  readonly tabEl: HTMLElement;
  private tabTitle: HTMLElement;
  private breadcrumb: HTMLElement;
  private titleEl: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private banner: HTMLElement;
  private readerScroll: HTMLElement;
  private readerSizer: HTMLElement;
  private sourceSizer: HTMLElement;
  private readerTitle: HTMLElement;
  private rendered: HTMLElement;
  private sourceScroll: HTMLElement;
  private sourceTitle: HTMLElement;
  private cmHost: HTMLElement;
  private emptyEl: HTMLElement;
  private findBar: FindBar;

  private editor: EditorView | null = null;
  /** Texte courant quand l'éditeur n'existe pas encore. */
  private text = '';
  private savedText = '';
  private renderedText: string | null = null;
  private renderSeq = 0;
  private saveTimer = 0;
  private statsTimer = 0;
  private saving: Promise<boolean> = Promise.resolve(true);
  private pendingDisk: FileData | null = null;

  constructor(private host: TabHost) {
    // En-tête de l'onglet dans la barre.
    this.tabEl = el('div', 'workspace-tab-header');
    this.tabEl.setAttribute('role', 'tab');
    const inner = el('div', 'workspace-tab-header-inner');
    this.tabTitle = el('div', 'workspace-tab-header-inner-title');
    const status = el('div', 'workspace-tab-header-status');
    const close = el('div', 'workspace-tab-header-inner-close-button');
    close.setAttribute('aria-label', 'Fermer');
    setIcon(close, 'x', 14);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      host.closeTab(this);
    });
    inner.append(this.tabTitle, status, close);
    this.tabEl.append(inner);

    // Vue.
    this.dom = el('div', 'workspace-leaf');
    const header = el('div', 'view-header');
    const titleBox = el('div', 'view-header-title-container');
    this.breadcrumb = el('span', 'view-header-breadcrumb');
    this.breadcrumb.addEventListener('click', () => this.file && host.revealFolder(this.file.dir));
    this.titleEl = el('span', 'view-header-title');
    titleBox.append(this.breadcrumb, el('span', 'view-header-breadcrumb-separator', '/'), this.titleEl);
    const actions = el('div', 'view-actions');
    this.modeBtn = el('button', 'clickable-icon view-action');
    this.modeBtn.addEventListener('click', () => void this.toggleMode());
    const more = el('button', 'clickable-icon view-action');
    more.setAttribute('aria-label', "Plus d'options");
    setIcon(more, 'ellipsis');
    more.addEventListener('click', () => host.showViewMenu(this, more));
    actions.append(this.modeBtn, more);
    header.append(titleBox, actions);

    this.banner = el('div', 'view-banner is-hidden');
    const content = el('div', 'view-content');

    this.readerScroll = el('div', 'markdown-reading-view');
    const readerSizer = (this.readerSizer = el('div', 'markdown-preview-sizer'));
    this.readerTitle = el('div', 'inline-title');
    this.rendered = el('div', 'markdown-rendered');
    readerSizer.append(this.readerTitle, this.rendered);
    this.readerScroll.append(readerSizer);
    this.rendered.addEventListener('click', (e) => this.onReaderClick(e));
    this.rendered.addEventListener('auxclick', (e) => e.button === 1 && this.onReaderClick(e));

    this.sourceScroll = el('div', 'markdown-source-view');
    const sourceSizer = (this.sourceSizer = el('div', 'markdown-source-sizer'));
    this.sourceTitle = el('div', 'inline-title');
    this.cmHost = el('div', 'cm-host');
    sourceSizer.append(this.sourceTitle, this.cmHost);
    this.sourceScroll.append(sourceSizer);
    this.sourceScroll.addEventListener('mousedown', (e) => {
      // Clic sous le texte : place le curseur à la fin, comme Obsidian.
      if (e.target === this.sourceScroll || e.target === sourceSizer) {
        e.preventDefault();
        this.editor?.focus();
        const end = this.editor?.state.doc.length ?? 0;
        this.editor?.dispatch({ selection: { anchor: end } });
      }
    });

    this.emptyEl = el('div', 'empty-state');
    this.findBar = new FindBar(
      () => this.rendered,
      () => this.readerScroll,
    );
    content.append(this.findBar.dom, this.readerScroll, this.sourceScroll, this.emptyEl);
    this.dom.append(header, this.banner, content);
    const fit = new ResizeObserver(() => this.fitZoom());
    fit.observe(readerSizer);
    fit.observe(sourceSizer);
    this.showPane('empty');
    this.updateHeader();
  }

  get title(): string {
    return this.file ? stem(this.file.name) : 'Nouvel onglet';
  }

  get path(): string | null {
    return this.file?.path ?? null;
  }

  currentText(): string {
    return this.editor ? this.editor.state.doc.toString() : this.text;
  }

  headings() {
    return headingsOf(this.currentText());
  }

  // --- Chargement ---

  async open(path: string, mode?: Mode): Promise<boolean> {
    let data: FileData;
    try {
      data = await api.readFile(path);
    } catch (e) {
      notice(errorMessage(e), 7000);
      return false;
    }
    await this.flush();
    const previous = this.file?.path;
    if (previous && previous !== data.path) void api.forgetFile(previous).catch(() => {});
    this.load(data, mode ?? settings.defaultMode);
    return true;
  }

  private load(data: FileData, mode: Mode): void {
    this.file = data;
    this.text = data.content;
    this.savedText = data.content;
    this.renderedText = null;
    this.missing = false;
    this.pendingDisk = null;
    this.setDirty(false);
    if (this.editor) resetEditor(this.editor, data.content, data.readonly);
    this.findBar.close();
    this.updateStats();
    if (data.lossy) {
      this.showBanner("Ce fichier n'est pas encodé en UTF-8 : il est affiché en lecture seule.");
    } else if (data.readonly) {
      this.showBanner('Fichier en lecture seule.');
    } else {
      this.hideBanner();
    }
    this.mode = mode;
    this.readerScroll.scrollTop = 0;
    this.sourceScroll.scrollTop = 0;
    void this.showMode(null);
  }

  setEmpty(): void {
    if (this.file) void api.forgetFile(this.file.path).catch(() => {});
    this.file = null;
    this.text = this.savedText = '';
    this.renderedText = null;
    this.setDirty(false);
    this.hideBanner();
    this.emptyEl.replaceChildren();
    this.host.buildEmptyState(this.emptyEl);
    this.showPane('empty');
    this.updateHeader();
    this.host.onTabChanged(this);
  }

  /** Reconstruit la page d'accueil (fichiers récents à jour). */
  refreshEmptyState(): void {
    if (this.file) return;
    this.emptyEl.replaceChildren();
    this.host.buildEmptyState(this.emptyEl);
  }

  // --- Modes ---

  async toggleMode(): Promise<void> {
    if (!this.file) return;
    await this.setMode(this.mode === 'preview' ? 'source' : 'preview');
  }

  async setMode(mode: Mode): Promise<void> {
    if (!this.file || mode === this.mode) return;
    const anchor = this.captureAnchor();
    this.mode = mode;
    if (mode === 'preview') void this.save();
    await this.showMode(anchor);
    if (mode === 'source') this.editor?.focus();
  }

  private async showMode(anchor: ScrollAnchor | null): Promise<void> {
    if (this.mode === 'source') {
      this.findBar.close();
      this.ensureEditor();
      this.showPane('source');
    } else {
      if (this.renderedText !== this.currentText()) await this.render();
      this.showPane('preview');
    }
    this.fitZoom();
    if (anchor) this.restoreAnchor(anchor, true);
    this.updateHeader();
    this.host.onTabChanged(this);
  }

  /**
   * Zoom sous 100 % : la note agrandie « comme une image » garde sa hauteur de mise en page, ce
   * qui laisserait du vide à faire défiler sous le texte. Une marge négative le retire.
   */
  fitZoom(): void {
    const z = settings.zoom;
    for (const sizer of [this.readerSizer, this.sourceSizer]) {
      sizer.style.marginBottom = z < 1 ? `${-(1 - z) * sizer.offsetHeight}px` : '';
    }
  }

  // --- Position de lecture ---

  private get scroller(): HTMLElement {
    return this.mode === 'source' ? this.sourceScroll : this.readerScroll;
  }

  /** Texte affiché à la hauteur `y` de la fenêtre (par défaut : en haut de la vue). */
  captureAnchor(y?: number): ScrollAnchor | null {
    if (!this.file) return null;
    const scroller = this.scroller;
    const top = scroller.getBoundingClientRect().top;
    const at = y ?? top;
    const atTop = scroller.scrollTop < 1 && y === undefined;
    if (this.mode === 'source') {
      if (!this.editor) return null;
      return { line: editorLineAtY(this.editor, at), offset: at - top, atTop };
    }
    const hit = lineAtY(this.rendered, at);
    return { line: hit.line, offset: hit.y - top, atTop };
  }

  /** Remet le texte de `anchor` à la même hauteur, dans le mode courant. */
  restoreAnchor(anchor: ScrollAnchor, justShown = false): void {
    this.stopSettling?.();
    if (this.mode === 'source') {
      const editor = this.editor;
      if (!editor) return;
      editor.requestMeasure();
      const apply = () => {
        if (anchor.atTop) this.sourceScroll.scrollTop = 0;
        else scrollEditorLineTo(editor, this.sourceScroll, anchor.line, anchor.offset);
      };
      // Éditeur qui vient d'être affiché : il se mesure d'abord.
      if (justShown) requestAnimationFrame(apply);
      else apply();
      return;
    }
    const apply = () => {
      if (anchor.atTop) {
        this.readerScroll.scrollTop = 0;
        return;
      }
      const y = yForLine(this.rendered, anchor.line);
      if (y === null) return;
      const top = this.readerScroll.getBoundingClientRect().top;
      this.readerScroll.scrollTop += y - (top + anchor.offset);
    };
    apply();
    this.settle(apply);
  }

  private stopSettling: (() => void) | null = null;

  /**
   * Images et diagrammes peuvent finir de s'afficher juste après : on recale
   * pendant un court instant, sauf dès que la vue défile pour une autre raison
   * (molette, barre de défilement, sommaire…).
   */
  private settle(apply: () => void): void {
    const scroller = this.readerScroll;
    let expected = scroller.scrollTop;
    const reapply = () => {
      apply();
      expected = scroller.scrollTop;
    };
    const onScroll = () => {
      if (Math.abs(scroller.scrollTop - expected) > 2) stop();
    };
    const observer = new ResizeObserver(() => {
      if (!scroller.classList.contains('is-hidden')) reapply();
    });
    observer.observe(this.rendered);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
      if (this.stopSettling === stop) this.stopSettling = null;
    };
    const timer = window.setTimeout(stop, 1500);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    this.stopSettling = stop;
  }

  private showPane(pane: 'preview' | 'source' | 'empty'): void {
    this.readerScroll.classList.toggle('is-hidden', pane !== 'preview');
    this.sourceScroll.classList.toggle('is-hidden', pane !== 'source');
    this.emptyEl.classList.toggle('is-hidden', pane !== 'empty');
    this.dom.classList.toggle('is-empty', pane === 'empty');
  }

  private ensureEditor(): EditorView {
    if (!this.editor) {
      this.editor = createEditor(this.cmHost, this.text, {
        readonly: !!this.file?.readonly,
        onChange: () => this.onEdit(),
        onSave: () => void this.save(true),
      });
    }
    return this.editor;
  }

  // --- Rendu ---

  private async render(): Promise<void> {
    const text = this.currentText();
    const seq = ++this.renderSeq;
    let html: string;
    try {
      html = await api.render(this.file?.path ?? null, text, settings.strictLineBreaks);
    } catch (e) {
      const p = el('p', 'render-error', `Rendu impossible : ${errorMessage(e)}`);
      html = p.outerHTML;
    }
    if (seq !== this.renderSeq) return;
    this.rendered.innerHTML = html;
    this.renderedText = text;
    await enhance(this.rendered, { toggleTask: (line) => this.toggleTask(line) });
    this.findBar.refresh();
  }

  /** Nouveau rendu en gardant la position (tâche cochée, fichier modifié ailleurs…). */
  async rerender(): Promise<void> {
    if (!this.file) return;
    if (this.mode !== 'preview') {
      this.renderedText = null;
      return;
    }
    const top = this.readerScroll.scrollTop;
    await this.render();
    this.fitZoom();
    this.readerScroll.scrollTop = top;
  }

  // --- Édition et enregistrement ---

  private onEdit(): void {
    this.setDirty(true);
    if (settings.autosave && !this.missing) {
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY);
    }
    clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => {
      this.updateStats();
      this.host.onTabChanged(this);
    }, 400);
  }

  private setText(next: string): void {
    if (this.editor) {
      const doc = this.editor.state.doc;
      // Modification d'utilisateur (annulable), qui déclenche onEdit().
      let start = 0;
      const old = doc.toString();
      while (start < old.length && old[start] === next[start]) start++;
      let endOld = old.length;
      let endNew = next.length;
      while (endOld > start && endNew > start && old[endOld - 1] === next[endNew - 1]) {
        endOld--;
        endNew--;
      }
      this.editor.dispatch({ changes: { from: start, to: endOld, insert: next.slice(start, endNew) } });
    } else {
      this.text = next;
      this.onEdit();
    }
  }

  save(explicit = false): Promise<boolean> {
    this.saving = this.saving.then(() => this.doSave(explicit));
    return this.saving;
  }

  private async doSave(explicit: boolean): Promise<boolean> {
    clearTimeout(this.saveTimer);
    const file = this.file;
    if (!file || file.readonly) return true;
    if (this.missing && !explicit) return false;
    if (this.pendingDisk && !explicit) return false;
    const text = this.currentText();
    if (text === this.savedText && !this.missing) {
      this.setDirty(false);
      return true;
    }
    try {
      file.mtime = await api.writeFile(file.path, text, file.crlf, file.bom);
      this.savedText = text;
      if (this.missing || this.pendingDisk) {
        this.missing = false;
        this.pendingDisk = null;
        this.hideBanner();
      }
      this.setDirty(this.currentText() !== this.savedText);
      return true;
    } catch (e) {
      notice(`Enregistrement impossible : ${errorMessage(e)}`, 8000);
      return false;
    }
  }

  /** Enregistre ce qui attend encore (avant de fermer, de changer de fichier…). */
  async flush(): Promise<boolean> {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return this.saving;
    if (!settings.autosave) return true;
    return this.save();
  }

  private setDirty(dirty: boolean): void {
    if (dirty === this.dirty && dirty) return;
    this.dirty = dirty;
    this.tabEl.classList.toggle('is-dirty', dirty);
    this.host.onTabChanged(this);
  }

  hasUnsavedChanges(): boolean {
    return !!this.file && this.currentText() !== this.savedText;
  }

  // --- Changements sur le disque ---

  applyExternal(data: FileData): void {
    if (!this.file) return;
    this.missing = false;
    if (this.hasUnsavedChanges() && this.currentText() !== data.content) {
      this.pendingDisk = data;
      this.showBanner('Ce fichier a été modifié par une autre application.', [
        ['Recharger', () => this.reloadFromDisk()],
        ['Garder ma version', () => void this.save(true)],
      ]);
      return;
    }
    const readonlyChanged = data.readonly !== this.file.readonly;
    this.file = data;
    this.text = data.content;
    this.savedText = data.content;
    this.pendingDisk = null;
    if (this.editor) {
      applyDiskText(this.editor, data.content);
      if (readonlyChanged) setReadonly(this.editor, data.readonly);
    }
    if (!data.readonly) this.hideBanner();
    this.setDirty(false);
    this.updateStats();
    void this.rerender();
    this.host.onTabChanged(this);
  }

  private reloadFromDisk(): void {
    const data = this.pendingDisk;
    if (!data || !this.file) return;
    this.pendingDisk = null;
    this.savedText = this.currentText();
    this.applyExternal(data);
    this.hideBanner();
  }

  markMissing(): void {
    if (!this.file || this.missing) return;
    this.missing = true;
    this.showBanner('Ce fichier a été supprimé, renommé ou déplacé.', [
      ['Le recréer ici', () => void this.save(true)],
      ["Fermer l'onglet", () => this.host.closeTab(this)],
    ]);
  }

  private showBanner(message: string, actions: [string, () => void][] = []): void {
    this.banner.replaceChildren(el('span', 'view-banner-text', message));
    for (const [label, fn] of actions) {
      const b = el('button', 'mod-banner-action', label);
      b.addEventListener('click', fn);
      this.banner.append(b);
    }
    this.banner.classList.remove('is-hidden');
  }

  private hideBanner(): void {
    this.banner.classList.add('is-hidden');
  }

  // --- Lecture : liens et cases à cocher ---

  private toggleTask(line: number): void {
    if (!this.file || this.file.readonly) {
      notice('Fichier en lecture seule.');
      return;
    }
    const lines = this.currentText().split('\n');
    const current = lines[line - 1];
    if (current === undefined) return;
    const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/.exec(current);
    if (!m) return;
    lines[line - 1] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + current.slice(m[0].length);
    this.setText(lines.join('\n'));
    void this.rerender();
  }

  private onReaderClick(e: MouseEvent): void {
    const target = e.target as Element;
    const node = target.closest<HTMLElement>('a, .markdown-embed');
    if (!node) return;
    e.preventDefault();
    if (node.classList.contains('tag')) return;
    const href = node.dataset.href ?? node.getAttribute('href') ?? '';
    if (!href) return;
    if (href.startsWith('#')) {
      this.scrollToAnchor(href);
      return;
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      this.host.openExternal(href);
      return;
    }
    if (/^[a-z][a-z0-9+.-]+:/i.test(href) && !/^file:/i.test(href)) return;
    this.host.openLink(this, { path: node.dataset.path, href }, e.ctrlKey || e.metaKey || e.button === 1);
  }

  scrollToAnchor(anchor: string): void {
    if (this.mode === 'preview') {
      const id = decodeURIComponent(anchor.slice(1));
      const target = this.rendered.querySelector(`[id="${CSS.escape(id)}"]`) ?? findHeading(this.rendered, anchor);
      if (target) scrollToElement(this.readerScroll, target);
    } else {
      const wanted = decodeURIComponent(anchor.replace(/^#\^?/, '')).toLowerCase();
      const h = this.headings().find((x) => x.text.toLowerCase() === wanted);
      if (h) this.scrollToLine(h.line);
    }
  }

  scrollToLine(line: number): void {
    if (this.mode === 'source' && this.editor) {
      editorScrollToLine(this.editor, line, true);
      this.editor.focus();
    } else {
      const target = elementForLine(this.rendered, line);
      if (target) scrollToElement(this.readerScroll, target);
    }
  }

  find(): void {
    if (!this.file) return;
    if (this.mode === 'preview') this.findBar.open();
    else if (this.editor) openSearch(this.editor);
  }

  closeFind(): boolean {
    if (this.findBar.isOpen) {
      this.findBar.close();
      return true;
    }
    return false;
  }

  /** Réglages modifiés : nouveau rendu, correcteur, etc. */
  refreshSettings(): void {
    if (this.editor) refreshSpellcheck(this.editor);
    this.renderedText = null;
    void this.rerender();
  }

  focus(): void {
    if (this.mode === 'source') this.editor?.focus();
  }

  // --- Affichage ---

  private updateStats(): void {
    const body = stripFrontMatter(this.currentText());
    this.stats = { words: countWords(body), chars: body.length };
  }

  private updateHeader(): void {
    const title = this.title;
    this.tabTitle.textContent = title;
    this.tabEl.title = this.file?.path ?? title;
    this.titleEl.textContent = title;
    this.breadcrumb.textContent = this.file ? basename(dirname(this.file.path)) : '';
    this.breadcrumb.title = this.file?.dir ?? '';
    this.dom.querySelector('.view-header-breadcrumb-separator')?.classList.toggle('is-hidden', !this.file);
    this.readerTitle.textContent = title;
    this.sourceTitle.textContent = title;
    const toSource = this.mode === 'preview';
    setIcon(this.modeBtn, toSource ? 'pencil' : 'book-open');
    const label = `${toSource ? 'Passer en mode édition' : 'Passer en mode lecture'} (${modKey}E)`;
    this.modeBtn.setAttribute('aria-label', label);
    this.modeBtn.title = label;
    this.modeBtn.classList.toggle('is-hidden', !this.file);
  }

  destroy(): void {
    clearTimeout(this.saveTimer);
    clearTimeout(this.statsTimer);
    if (this.file) void api.forgetFile(this.file.path).catch(() => {});
    this.editor?.destroy();
    this.dom.remove();
    this.tabEl.remove();
  }
}
