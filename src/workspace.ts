// L'espace de travail : onglets, panneaux latéraux, raccourcis, fenêtre.
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { api, errorMessage, isTauri, modKey, platform, type FileData } from './api';
import { Explorer } from './explorer';
import { setIcon, windowControlIcon } from './icons';
import { Outline } from './outline';
import { basename, dirname, NOTE_EXT, samePath } from './paths';
import { addRecent, applyAppearance, onSettingsChange, saveSession, session, settings, updateSettings, type Mode } from './settings';
import { Tab, type TabHost } from './tab';
import { copyText, dropdown, el, iconButton, Menu, notice, openModal, settingRow, toggle } from './ui';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'txt'] }];

export class Workspace implements TabHost {
  tabs: Tab[] = [];
  active: Tab | null = null;
  private explorer: Explorer;
  private outline = new Outline();
  private tabList = $('tab-list');
  private leaves = $('workspace');
  private statusBar = $('status-bar');
  private sessionTimer = 0;
  private outlineTimer = 0;
  /** Onglets fermés, pour Ctrl+Maj+T. */
  private closed: string[] = [];
  private windowTitle = '';

  constructor() {
    this.explorer = new Explorer({
      openFile: (path, newTab) => void this.openFile(path, { newTab }),
      revealInSystem: (path) => this.revealInSystem(path),
      copyPath: (path) => void copyText(path).then(() => notice('Chemin copié', 1500)),
      onRootChanged: () => {
        session.explorerRoot = this.explorer.root;
        session.explorerPinned = this.explorer.pinned;
        this.saveSessionSoon();
      },
    });
    this.outline.setHandler((line) => this.active?.scrollToLine(line));
  }

  async start(): Promise<void> {
    applyAppearance();
    this.buildChrome();
    this.layout();
    this.bindKeys();
    if (isTauri) {
      this.bindWindow();
      await this.listenBackend();
    }
    onSettingsChange((changed) => {
      if ('strictLineBreaks' in changed || 'theme' in changed || 'spellcheck' in changed) {
        this.tabs.forEach((t) => t.refreshSettings());
      }
      this.layout();
    });

    if (session.explorerRoot) this.explorer.setRoot(session.explorerRoot, session.explorerPinned);
    const files = await api.startupFiles().catch(() => [] as string[]);
    if (files.length) {
      for (const f of files) await this.openFile(f, { newTab: true });
    } else {
      await this.restoreSession();
    }
    if (!this.tabs.length) this.newTab();
    if (isTauri) await getCurrentWindow().show();
  }

  // --- Onglets ---

  private createTab(): Tab {
    const tab = new Tab(this);
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
    this.tabs.splice(at, 0, tab);
    this.leaves.append(tab.dom);
    const header = tab.tabEl;
    header.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    header.addEventListener('auxclick', (e) => e.button === 1 && void this.closeTab(tab));
    header.addEventListener('contextmenu', (e) => this.tabMenu(tab).showAtMouse(e));
    header.addEventListener('pointerdown', (e) => this.dragTab(tab, e));
    this.renderTabList();
    return tab;
  }

  newTab(): Tab {
    const tab = this.createTab();
    tab.setEmpty();
    this.activate(tab);
    return tab;
  }

  activate(tab: Tab): void {
    this.active = tab;
    for (const t of this.tabs) {
      t.dom.classList.toggle('is-active', t === tab);
      t.tabEl.classList.toggle('is-active', t === tab);
    }
    tab.refreshEmptyState();
    tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.explorer.follow(tab.path);
    this.onTabChanged(tab);
    requestAnimationFrame(() => tab.focus());
  }

  private renderTabList(): void {
    this.tabList.replaceChildren(...this.tabs.map((t) => t.tabEl));
    this.saveSessionSoon();
  }

  async closeTab(tab: Tab): Promise<void> {
    if (!(await this.confirmClose([tab]))) return;
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    if (tab.path) this.closed.push(tab.path);
    this.tabs.splice(i, 1);
    tab.destroy();
    if (!this.tabs.length) {
      this.active = null;
      this.newTab();
    } else if (this.active === tab) {
      this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]);
    }
    this.renderTabList();
  }

  private async closeTabs(tabs: Tab[]): Promise<void> {
    for (const t of tabs) await this.closeTab(t);
  }

  /** Enregistre (ou fait choisir) avant de fermer ; faux = annuler. */
  private async confirmClose(tabs: Tab[]): Promise<boolean> {
    for (const t of tabs) await t.flush();
    const unsaved = tabs.filter((t) => t.hasUnsavedChanges());
    if (!unsaved.length) return true;
    const names = unsaved.map((t) => `« ${t.title} »`).join(', ');
    const choice = await this.choose(
      'Modifications non enregistrées',
      `${names} : enregistrer les modifications avant de fermer ?`,
      [
        ['save', 'Enregistrer', true],
        ['discard', 'Ne pas enregistrer', false],
        ['cancel', 'Annuler', false],
      ],
    );
    if (choice === 'cancel' || choice === null) return false;
    if (choice === 'save') {
      for (const t of unsaved) if (!(await t.save(true))) return false;
    }
    return true;
  }

  private choose(title: string, message: string, buttons: [string, string, boolean][]): Promise<string | null> {
    return new Promise((resolve) => {
      let answered = false;
      const close = openModal(title, (content, closeModal) => {
        content.append(el('p', 'modal-text', message));
        const row = el('div', 'modal-button-container');
        for (const [value, label, primary] of buttons) {
          const b = el('button', primary ? 'mod-cta' : '', label);
          b.addEventListener('click', () => {
            answered = true;
            closeModal();
            resolve(value);
          });
          row.append(b);
        }
        content.append(row);
      });
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.modal-container')) {
          observer.disconnect();
          if (!answered) resolve(null);
        }
      });
      observer.observe(document.body, { childList: true });
      void close;
    });
  }

  private nextTab(delta: number): void {
    if (!this.active || this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
  }

  /** Glisser un onglet pour le déplacer. */
  private dragTab(tab: Tab, e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.workspace-tab-header-inner-close-button')) return;
    this.activate(tab);
    const startX = e.clientX;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 6) return;
      if (!dragging) {
        dragging = true;
        tab.tabEl.classList.add('is-dragging');
      }
      const i = this.tabs.indexOf(tab);
      for (const [j, other] of this.tabs.entries()) {
        if (other === tab) continue;
        const r = other.tabEl.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        if ((j < i && ev.clientX < mid) || (j > i && ev.clientX > mid)) {
          this.tabs.splice(i, 1);
          this.tabs.splice(j, 0, tab);
          this.renderTabList();
          break;
        }
      }
    };
    const up = () => {
      tab.tabEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // --- Ouverture de fichiers ---

  async openFile(path: string, opts: { newTab?: boolean; mode?: Mode; anchor?: string } = {}): Promise<Tab | null> {
    const existing = this.tabs.find((t) => t.path && samePath(t.path, path));
    if (existing) {
      this.activate(existing);
      if (opts.anchor) existing.scrollToAnchor(opts.anchor);
      return existing;
    }
    const reuse = this.active && (!this.active.file || !opts.newTab) ? this.active : null;
    if (reuse?.file && !(await this.confirmClose([reuse]))) return null;
    const tab = reuse ?? this.createTab();
    const ok = await tab.open(path, opts.mode);
    if (!ok) {
      if (!reuse) {
        this.tabs.splice(this.tabs.indexOf(tab), 1);
        tab.destroy();
        this.renderTabList();
      }
      return null;
    }
    if (tab.path) addRecent(tab.path);
    this.activate(tab);
    this.renderTabList();
    if (opts.anchor) setTimeout(() => tab.scrollToAnchor(opts.anchor!), 50);
    return tab;
  }

  async openLink(tab: Tab, link: { path?: string; href: string }, newTab: boolean): Promise<void> {
    const hash = link.href.indexOf('#');
    const anchor = hash >= 0 ? link.href.slice(hash) : '';
    let target = link.path ?? null;
    if (!target) target = await api.resolveLink(tab.path, link.href).catch(() => null);
    if (!target) {
      const name = decodeURIComponent((hash >= 0 ? link.href.slice(0, hash) : link.href) || link.href);
      notice(`« ${name} » est introuvable.`);
      return;
    }
    if (!NOTE_EXT.test(target)) {
      this.revealInSystem(target);
      return;
    }
    await this.openFile(target, { newTab, anchor: anchor || undefined });
  }

  openExternal(url: string): void {
    if (isTauri) openUrl(url).catch((e) => notice(errorMessage(e)));
    else window.open(url, '_blank');
  }

  private async openFileDialog(): Promise<void> {
    if (!isTauri) return;
    const picked = await openDialog({ multiple: true, directory: false, filters: MD_FILTER, defaultPath: this.active?.file?.dir });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const p of paths) await this.openFile(p, { newTab: true });
  }

  private async openFolderDialog(): Promise<void> {
    if (!isTauri) return;
    const picked = await openDialog({ directory: true, multiple: false, defaultPath: this.explorer.root ?? undefined });
    if (typeof picked === 'string') {
      this.explorer.setRoot(picked, true);
      if (!settings.leftOpen) updateSettings({ leftOpen: true });
    }
  }

  private async newFileDialog(): Promise<void> {
    if (!isTauri) return;
    const dir = this.explorer.root ?? this.active?.file?.dir;
    const picked = await saveDialog({
      title: 'Nouveau fichier Markdown',
      defaultPath: dir ? `${dir}${platform === 'windows' ? '\\' : '/'}Sans titre.md` : 'Sans titre.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!picked) return;
    const path = /\.[^\\/.]+$/.test(picked) ? picked : `${picked}.md`;
    try {
      const data: FileData = await api.createFile(path);
      await this.openFile(data.path, { newTab: true, mode: 'source' });
      void this.explorer.refresh();
    } catch (e) {
      notice(errorMessage(e), 7000);
    }
  }

  revealFolder(dir: string): void {
    this.explorer.setRoot(dir, true);
    if (!settings.leftOpen) updateSettings({ leftOpen: true });
  }

  private revealInSystem(path: string): void {
    if (isTauri) revealItemInDir(path).catch((e) => notice(errorMessage(e)));
  }

  // --- Mise à jour de l'affichage ---

  onTabChanged(tab: Tab): void {
    if (tab !== this.active) return;
    this.updateStatus();
    clearTimeout(this.outlineTimer);
    this.outlineTimer = window.setTimeout(() => this.outline.update(tab.file ? tab.headings() : null), 150);
    const title = tab.file ? `${tab.title} - Vitrum` : 'Vitrum';
    if (isTauri && title !== this.windowTitle) {
      this.windowTitle = title;
      void getCurrentWindow().setTitle(title).catch(() => {});
    }
    this.saveSessionSoon();
  }

  private updateStatus(): void {
    const tab = this.active;
    this.statusBar.replaceChildren();
    if (!tab?.file) {
      this.statusBar.classList.add('is-hidden');
      return;
    }
    this.statusBar.classList.remove('is-hidden');
    const item = (text: string, cls = '') => {
      const s = el('div', `status-bar-item ${cls}`, text);
      this.statusBar.append(s);
      return s;
    };
    if (tab.file.readonly) item('Lecture seule', 'mod-warning');
    if (tab.dirty && !settings.autosave) item('Non enregistré', 'mod-warning');
    const mode = item(tab.mode === 'preview' ? 'Lecture' : 'Édition', 'mod-clickable');
    mode.title = `Changer de mode (${modKey}E)`;
    mode.addEventListener('click', () => void tab.toggleMode());
    const fmt = (n: number) => n.toLocaleString('fr-FR');
    item(`${fmt(tab.stats.words)} mot${tab.stats.words > 1 ? 's' : ''}`);
    item(`${fmt(tab.stats.chars)} caractère${tab.stats.chars > 1 ? 's' : ''}`);
  }

  private saveSessionSoon(): void {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = window.setTimeout(() => this.saveSessionNow(), 300);
  }

  private saveSessionNow(): void {
    session.tabs = this.tabs.filter((t) => t.path).map((t) => ({ path: t.path, mode: t.mode }));
    const withFile = this.tabs.filter((t) => t.path);
    session.active = this.active ? Math.max(0, withFile.indexOf(this.active)) : 0;
    saveSession();
  }

  private async restoreSession(): Promise<void> {
    const saved = session.tabs.filter((t) => t.path);
    const activeIndex = session.active;
    let activeTab: Tab | null = null;
    for (const [i, t] of saved.entries()) {
      const tab = this.createTab();
      this.active = tab;
      if (await tab.open(t.path!, t.mode)) {
        if (i === activeIndex) activeTab = tab;
      } else {
        this.tabs.splice(this.tabs.indexOf(tab), 1);
        tab.destroy();
      }
    }
    this.renderTabList();
    const target = activeTab ?? this.tabs[0];
    if (target) this.activate(target);
  }

  // --- Interface : barre, panneaux, menus ---

  private buildChrome(): void {
    setIcon($('btn-toggle-left'), 'panel-left');
    $('btn-toggle-left').title = "Afficher ou masquer l'explorateur";
    $('btn-toggle-left').addEventListener('click', () => updateSettings({ leftOpen: !settings.leftOpen }));
    setIcon($('btn-toggle-right'), 'list-tree');
    $('btn-toggle-right').title = 'Afficher ou masquer le plan';
    $('btn-toggle-right').addEventListener('click', () => updateSettings({ rightOpen: !settings.rightOpen }));
    setIcon($('btn-new-tab'), 'plus');
    $('btn-new-tab').title = `Nouvel onglet (${modKey}T)`;
    $('btn-new-tab').addEventListener('click', () => this.newTab());

    const ribbon = $('ribbon');
    const top = el('div', 'side-dock-actions');
    top.append(
      iconButton('file-text', `Ouvrir un fichier (${modKey}O)`, () => void this.openFileDialog()),
      iconButton('file-plus', `Nouveau fichier (${modKey}N)`, () => void this.newFileDialog()),
      iconButton('folder-open', 'Ouvrir un dossier', () => void this.openFolderDialog()),
      iconButton('history', 'Fichiers récents', (e) => this.recentMenu().showBelow(e.currentTarget as HTMLElement)),
    );
    const bottom = el('div', 'side-dock-settings');
    const themeBtn = iconButton('sun', 'Thème', (e) => this.themeMenu().showBelow(e.currentTarget as HTMLElement));
    bottom.append(themeBtn, iconButton('settings', `Paramètres (${modKey},)`, () => this.openSettings()));
    ribbon.append(top, bottom);
    onSettingsChange(() => setIcon(themeBtn, document.body.classList.contains('theme-dark') ? 'moon' : 'sun'));
    setIcon(themeBtn, document.body.classList.contains('theme-dark') ? 'moon' : 'sun');

    $('sidebar-left').append(this.explorer.dom);
    const outlineHeader = el('div', 'nav-header');
    outlineHeader.append(el('div', 'nav-folder-title-root', 'Plan'));
    $('sidebar-right').append(outlineHeader, this.outline.dom);
    this.outline.update(null);

    for (const side of ['left', 'right'] as const) this.bindResize(side);

    if (platform === 'windows' && isTauri) {
      const controls = $('window-controls');
      const win = getCurrentWindow();
      const btn = (kind: 'minimize' | 'maximize' | 'close', label: string, fn: () => void) => {
        const b = el('button', `window-control mod-${kind}`);
        b.innerHTML = windowControlIcon(kind);
        b.title = label;
        b.addEventListener('click', fn);
        controls.append(b);
        return b;
      };
      btn('minimize', 'Réduire', () => void win.minimize());
      const max = btn('maximize', 'Agrandir', () => void win.toggleMaximize());
      btn('close', 'Fermer', () => void win.close());
      const sync = async () => {
        const maximized = await win.isMaximized();
        max.innerHTML = windowControlIcon(maximized ? 'restore' : 'maximize');
        max.title = maximized ? 'Restaurer' : 'Agrandir';
        document.body.classList.toggle('is-maximized', maximized);
      };
      void win.onResized(() => void sync());
      void sync();
    }

    // Menu contextuel natif seulement là où il sert (texte sélectionné, saisie).
    document.addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.cm-content, input, textarea')) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
    });
  }

  private layout(): void {
    const app = $('app');
    app.style.setProperty('--left-width', settings.leftOpen ? `${settings.leftWidth}px` : '0px');
    app.style.setProperty('--right-width', settings.rightOpen ? `${settings.rightWidth}px` : '0px');
    app.classList.toggle('is-left-collapsed', !settings.leftOpen);
    app.classList.toggle('is-right-collapsed', !settings.rightOpen);
  }

  private bindResize(side: 'left' | 'right'): void {
    const handle = $(`resize-${side}`);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const start = side === 'left' ? settings.leftWidth : settings.rightWidth;
      document.body.classList.add('is-resizing');
      const move = (ev: PointerEvent) => {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        const width = Math.round(Math.max(180, Math.min(600, start + delta)));
        if (side === 'left') settings.leftWidth = width;
        else settings.rightWidth = width;
        this.layout();
      };
      const up = () => {
        document.body.classList.remove('is-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        updateSettings({ leftWidth: settings.leftWidth, rightWidth: settings.rightWidth });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  private tabMenu(tab: Tab): Menu {
    const others = this.tabs.filter((t) => t !== tab);
    const right = this.tabs.slice(this.tabs.indexOf(tab) + 1);
    const m = new Menu()
      .addItem({ title: 'Fermer', icon: 'x', onClick: () => void this.closeTab(tab) })
      .addItem({ title: 'Fermer les autres onglets', disabled: !others.length, onClick: () => void this.closeTabs(others) })
      .addItem({ title: 'Fermer les onglets à droite', disabled: !right.length, onClick: () => void this.closeTabs(right) });
    if (tab.file) {
      const path = tab.file.path;
      m.addSeparator()
        .addItem({ title: 'Copier le chemin', icon: 'copy', onClick: () => void copyText(path).then(() => notice('Chemin copié', 1500)) })
        .addItem({ title: "Afficher dans l'explorateur système", icon: 'external-link', onClick: () => this.revealInSystem(path) });
    }
    return m;
  }

  showViewMenu(tab: Tab, anchor: HTMLElement): void {
    if (!tab.file) return;
    const path = tab.file.path;
    new Menu()
      .addItem({
        title: tab.mode === 'preview' ? 'Mode édition' : 'Mode lecture',
        icon: tab.mode === 'preview' ? 'pencil' : 'book-open',
        onClick: () => void tab.toggleMode(),
      })
      .addItem({ title: 'Rechercher dans le document', icon: 'search', onClick: () => tab.find() })
      .addSeparator()
      .addItem({ title: 'Copier le chemin du fichier', icon: 'copy', onClick: () => void copyText(path).then(() => notice('Chemin copié', 1500)) })
      .addItem({ title: "Afficher dans l'explorateur système", icon: 'external-link', onClick: () => this.revealInSystem(path) })
      .addItem({ title: 'Afficher le dossier dans le panneau', icon: 'folder-open', onClick: () => this.revealFolder(tab.file!.dir) })
      .addSeparator()
      .addItem({ title: "Fermer l'onglet", icon: 'x', onClick: () => void this.closeTab(tab) })
      .showBelow(anchor, true);
  }

  private recentMenu(): Menu {
    const m = new Menu();
    if (!session.recent.length) m.addItem({ title: 'Aucun fichier récent', disabled: true, onClick: () => {} });
    for (const p of session.recent.slice(0, 12)) {
      m.addItem({ title: `${basename(p)}  —  ${basename(dirname(p))}`, icon: 'file-text', onClick: () => void this.openFile(p, { newTab: true }) });
    }
    return m;
  }

  private themeMenu(): Menu {
    const set = (theme: 'system' | 'light' | 'dark') => () => updateSettings({ theme });
    return new Menu()
      .addItem({ title: 'Selon le système', icon: 'monitor', checked: settings.theme === 'system', onClick: set('system') })
      .addItem({ title: 'Clair', icon: 'sun', checked: settings.theme === 'light', onClick: set('light') })
      .addItem({ title: 'Sombre', icon: 'moon', checked: settings.theme === 'dark', onClick: set('dark') });
  }

  buildEmptyState(container: HTMLElement): void {
    const box = el('div', 'empty-state-container');
    box.append(el('div', 'empty-state-title', 'Aucun fichier ouvert'));
    const actions = el('div', 'empty-state-action-list');
    const action = (label: string, shortcut: string, fn: () => void) => {
      const a = el('div', 'empty-state-action', label);
      if (shortcut) a.append(el('span', 'empty-state-shortcut', shortcut));
      a.addEventListener('click', fn);
      actions.append(a);
    };
    action('Ouvrir un fichier', `${modKey}O`, () => void this.openFileDialog());
    action('Créer un fichier', `${modKey}N`, () => void this.newFileDialog());
    action('Ouvrir un dossier', '', () => void this.openFolderDialog());
    box.append(actions);
    if (session.recent.length) {
      box.append(el('div', 'empty-state-subtitle', 'Fichiers récents'));
      const list = el('div', 'empty-state-recent-list');
      for (const p of session.recent.slice(0, 8)) {
        const row = el('div', 'empty-state-recent');
        row.append(el('span', 'empty-state-recent-name', basename(p)), el('span', 'empty-state-recent-dir', dirname(p)));
        row.title = p;
        row.addEventListener('click', () => void this.openFile(p));
        list.append(row);
      }
      box.append(list);
    }
    container.append(box);
  }

  private openSettings(): void {
    openModal('Paramètres', (content) => {
      const section = (title: string) => content.append(el('div', 'setting-heading', title));
      section('Apparence');
      content.append(
        settingRow(
          'Thème',
          '',
          dropdown(
            [
              ['system', 'Selon le système'],
              ['light', 'Clair'],
              ['dark', 'Sombre'],
            ],
            settings.theme,
            (v) => updateSettings({ theme: v }),
          ),
        ),
      );
      const size = el('input', 'slider');
      size.type = 'range';
      size.min = '12';
      size.max = '24';
      size.value = String(settings.fontSize);
      const sizeLabel = el('span', 'slider-value', `${settings.fontSize} px`);
      size.addEventListener('input', () => {
        sizeLabel.textContent = `${size.value} px`;
        updateSettings({ fontSize: Number(size.value) });
      });
      const sizeBox = el('div', 'slider-box');
      sizeBox.append(size, sizeLabel);
      content.append(settingRow('Taille du texte', '', sizeBox));
      content.append(
        settingRow('Largeur de lecture limitée', 'Le texte ne dépasse pas une largeur confortable à lire.', toggle(settings.readableLineLength, (v) => updateSettings({ readableLineLength: v }))),
      );

      section('Édition');
      content.append(
        settingRow(
          "Mode à l'ouverture",
          `Mode des fichiers ouverts. ${modKey}E bascule entre les deux.`,
          dropdown(
            [
              ['preview', 'Lecture'],
              ['source', 'Édition'],
            ],
            settings.defaultMode,
            (v) => updateSettings({ defaultMode: v }),
          ),
        ),
        settingRow('Enregistrement automatique', `Comme Obsidian : chaque modification est enregistrée après une seconde. Sinon, ${modKey}S.`, toggle(settings.autosave, (v) => updateSettings({ autosave: v }))),
        settingRow('Correcteur orthographique', '', toggle(settings.spellcheck, (v) => updateSettings({ spellcheck: v }))),
        settingRow('Sauts de ligne stricts', "Réglage d'Obsidian : un simple retour à la ligne ne crée pas de saut de ligne en lecture.", toggle(settings.strictLineBreaks, (v) => updateSettings({ strictLineBreaks: v }))),
      );

      section('Fichiers .md');
      const defaultRow = el('div');
      content.append(defaultRow);
      void this.fillDefaultAppRow(defaultRow);

      const about = el('div', 'setting-about', 'Vitrum');
      content.append(about);
      if (isTauri) void getVersion().then((v) => (about.textContent = `Vitrum ${v}`));
    });
  }

  private async fillDefaultAppRow(container: HTMLElement): Promise<void> {
    if (platform === 'macos') {
      container.append(
        settingRow(
          'Application par défaut',
          'Dans le Finder : clic droit sur un fichier .md › Lire les informations › « Ouvrir avec » : Vitrum › Tout modifier.',
          el('span'),
        ),
      );
      return;
    }
    const status = await api.defaultAppStatus().catch(() => null);
    let desc: string;
    if (status?.isDefault) desc = 'Vitrum ouvre déjà les fichiers .md par défaut.';
    else if (status?.registered)
      desc = 'Ouvre les Paramètres de Windows : cliquez sur .md, choisissez Vitrum puis « Définir par défaut ».';
    else desc = "Vitrum n'est pas encore installé : son installateur l'ajoute au menu « Ouvrir avec » et le propose par défaut.";
    const button = el('button', status?.isDefault ? '' : 'mod-cta', status?.isDefault ? 'Modifier…' : 'Définir par défaut…');
    button.addEventListener('click', () => void api.openDefaultAppSettings().catch((e) => notice(errorMessage(e), 7000)));
    container.append(settingRow('Application par défaut', desc, button));
  }

  // --- Raccourcis, fenêtre, événements du cœur ---

  private bindKeys(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        const mod = platform === 'macos' ? e.metaKey : e.ctrlKey;
        const tab = this.active;
        if (e.ctrlKey && e.key === 'Tab') {
          e.preventDefault();
          this.nextTab(e.shiftKey ? -1 : 1);
          return;
        }
        if (mod && (e.key === 'PageDown' || e.key === 'PageUp')) {
          e.preventDefault();
          this.nextTab(e.key === 'PageDown' ? 1 : -1);
          return;
        }
        if (e.key === 'Escape' && tab?.closeFind()) {
          e.preventDefault();
          return;
        }
        if (!mod || e.altKey) return;
        const key = e.key.toLowerCase();
        const run = (fn: () => void) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        };
        if (e.shiftKey) {
          if (key === 't') {
            run(() => {
              const last = this.closed.pop();
              if (last) void this.openFile(last, { newTab: true });
            });
          }
          return;
        }
        switch (key) {
          case 'o':
            return run(() => void this.openFileDialog());
          case 'n':
            return run(() => void this.newFileDialog());
          case 't':
            return run(() => this.newTab());
          case 'w':
            return run(() => tab && void this.closeTab(tab));
          case 'e':
            return run(() => tab && void tab.toggleMode());
          case 's':
            return run(() => tab && void tab.save(true));
          case ',':
            return run(() => this.openSettings());
          case 'f':
            if (tab?.mode === 'source' && (e.target as Element).closest?.('.cm-editor')) return;
            return run(() => tab?.find());
        }
      },
      true,
    );
  }

  private bindWindow(): void {
    const win = getCurrentWindow();
    void win.onCloseRequested(async (event) => {
      this.saveSessionNow();
      if (!(await this.confirmClose(this.tabs))) event.preventDefault();
    });
    window.addEventListener('blur', () => this.tabs.forEach((t) => void t.flush()));

    const overlay = $('drop-overlay');
    void getCurrentWebview().onDragDropEvent(async (event) => {
      const p = event.payload;
      if (p.type === 'enter' || p.type === 'over') overlay.classList.add('is-visible');
      else if (p.type === 'leave') overlay.classList.remove('is-visible');
      else if (p.type === 'drop') {
        overlay.classList.remove('is-visible');
        for (const path of p.paths) {
          if (NOTE_EXT.test(path)) {
            await this.openFile(path, { newTab: true });
          } else {
            // Un dossier : l'afficher dans l'explorateur.
            const isDir = await api.listDir(path).then(() => true, () => false);
            if (isDir) this.revealFolder(path);
            else notice(`« ${basename(path)} » n'est pas un fichier Markdown.`);
          }
        }
      }
    });
  }

  private async listenBackend(): Promise<void> {
    await listen<string[]>('open-files', async (e) => {
      for (const p of e.payload) await this.openFile(p, { newTab: true });
    });
    await listen<FileData>('file-changed', (e) => {
      this.tabs.find((t) => t.path && samePath(t.path, e.payload.path))?.applyExternal(e.payload);
    });
    await listen<string>('file-removed', (e) => {
      this.tabs.find((t) => t.path && samePath(t.path, e.payload))?.markMissing();
    });
  }
}
