// Explorateur de fichiers (panneau de gauche) : le dossier de la note active,
// ou un dossier choisi, avec ses sous-dossiers dépliables.
import { api, errorMessage, type DirEntry } from './api';
import { setIcon } from './icons';
import { basename, dirname, isInside, samePath, stem } from './paths';
import { el, iconButton, Menu } from './ui';

export interface ExplorerHost {
  openFile(path: string, newTab: boolean): void;
  revealInSystem(path: string): void;
  copyPath(path: string): void;
  onRootChanged(root: string | null): void;
}

export class Explorer {
  readonly dom: HTMLElement;
  root: string | null = null;
  /** Dossier choisi à la main : ne suit plus la note active. */
  pinned = false;
  private titleEl: HTMLElement;
  private tree: HTMLElement;
  private expanded = new Set<string>();
  private activePath: string | null = null;

  constructor(private host: ExplorerHost) {
    this.dom = el('div', 'file-explorer');
    const header = el('div', 'nav-header');
    this.titleEl = el('div', 'nav-folder-title-root');
    const buttons = el('div', 'nav-buttons-container');
    buttons.append(
      iconButton('arrow-up', 'Dossier parent', () => this.goUp()),
      iconButton('refresh-cw', 'Actualiser', () => void this.refresh()),
      iconButton('chevrons-down-up', 'Tout replier', () => {
        this.expanded.clear();
        void this.refresh();
      }),
    );
    header.append(this.titleEl, buttons);
    this.tree = el('div', 'nav-files-container');
    this.dom.append(header, this.tree);
    this.render();
  }

  /** La note active a changé : suit son dossier si nécessaire. */
  follow(path: string | null): void {
    this.activePath = path;
    if (path && !this.pinned && (!this.root || !isInside(path, this.root))) {
      this.setRoot(dirname(path), false);
    } else {
      this.markActive();
    }
  }

  setRoot(root: string | null, pinned: boolean): void {
    this.root = root;
    this.pinned = pinned;
    this.expanded.clear();
    // Déplie le chemin jusqu'à la note active.
    if (root && this.activePath && isInside(this.activePath, root)) {
      let dir = dirname(this.activePath);
      while (isInside(dir, root) && !samePath(dir, root)) {
        this.expanded.add(dir.toLowerCase());
        dir = dirname(dir);
      }
    }
    this.host.onRootChanged(root);
    void this.refresh();
  }

  private goUp(): void {
    if (!this.root) return;
    const parent = dirname(this.root);
    if (!samePath(parent, this.root)) this.setRoot(parent, true);
  }

  async refresh(): Promise<void> {
    this.render();
    if (!this.root) return;
    await this.fill(this.tree, this.root, 0);
    this.markActive();
  }

  private render(): void {
    this.titleEl.textContent = this.root ? basename(this.root) : 'Fichiers';
    this.titleEl.title = this.root ?? '';
    this.tree.replaceChildren();
    if (!this.root) this.tree.append(el('div', 'pane-empty', 'Ouvrez un fichier ou un dossier.'));
  }

  private async fill(container: HTMLElement, dir: string, depth: number): Promise<void> {
    let entries: DirEntry[];
    try {
      entries = await api.listDir(dir);
    } catch (e) {
      container.append(el('div', 'pane-empty', errorMessage(e)));
      return;
    }
    if (!entries.length && depth === 0) {
      container.append(el('div', 'pane-empty', 'Aucune note dans ce dossier.'));
    }
    for (const entry of entries) container.append(this.item(entry, depth));
  }

  private item(entry: DirEntry, depth: number): HTMLElement {
    const wrap = el('div', entry.isDir ? 'tree-item nav-folder' : 'tree-item nav-file');
    const self = el('div', 'tree-item-self is-clickable');
    self.style.paddingInlineStart = `${8 + depth * 16}px`;
    self.dataset.path = entry.path;
    self.title = entry.path;
    if (entry.isDir) {
      const chevron = el('div', 'tree-item-icon collapse-icon');
      setIcon(chevron, 'chevron-right', 14);
      self.append(chevron, el('div', 'tree-item-inner', entry.name));
      const children = el('div', 'tree-item-children');
      const key = entry.path.toLowerCase();
      const toggle = async () => {
        const open = !wrap.classList.contains('is-open');
        wrap.classList.toggle('is-open', open);
        if (open) {
          this.expanded.add(key);
          children.replaceChildren();
          await this.fill(children, entry.path, depth + 1);
          this.markActive();
        } else {
          this.expanded.delete(key);
          children.replaceChildren();
        }
      };
      self.addEventListener('click', () => void toggle());
      self.addEventListener('contextmenu', (e) =>
        new Menu()
          .addItem({ title: 'Afficher ce dossier ici', icon: 'folder-open', onClick: () => this.setRoot(entry.path, true) })
          .addItem({ title: "Ouvrir dans l'explorateur système", icon: 'external-link', onClick: () => this.host.revealInSystem(entry.path) })
          .addItem({ title: 'Copier le chemin', icon: 'copy', onClick: () => this.host.copyPath(entry.path) })
          .showAtMouse(e),
      );
      wrap.append(self, children);
      if (this.expanded.has(key)) void toggle();
    } else {
      self.append(el('div', 'tree-item-inner', stem(entry.name)));
      const ext = /\.([^.]+)$/.exec(entry.name)?.[1]?.toLowerCase();
      if (ext && ext !== 'md') self.append(el('div', 'nav-file-tag', ext));
      self.addEventListener('click', (e) => this.host.openFile(entry.path, e.ctrlKey || e.metaKey));
      self.addEventListener('auxclick', (e) => e.button === 1 && this.host.openFile(entry.path, true));
      self.addEventListener('contextmenu', (e) =>
        new Menu()
          .addItem({ title: 'Ouvrir dans un nouvel onglet', icon: 'file-plus', onClick: () => this.host.openFile(entry.path, true) })
          .addItem({ title: "Afficher dans l'explorateur système", icon: 'external-link', onClick: () => this.host.revealInSystem(entry.path) })
          .addItem({ title: 'Copier le chemin', icon: 'copy', onClick: () => this.host.copyPath(entry.path) })
          .showAtMouse(e),
      );
      wrap.append(self);
    }
    return wrap;
  }

  private markActive(): void {
    this.tree.querySelectorAll('.nav-file > .tree-item-self').forEach((node) => {
      const p = (node as HTMLElement).dataset.path ?? '';
      node.classList.toggle('is-active', !!this.activePath && samePath(p, this.activePath));
    });
  }
}
