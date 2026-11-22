// Icônes Lucide (celles d'Obsidian), regroupées ici pour n'embarquer que l'utile.
import {
  createElement,
  AlignLeft,
  ArrowUp,
  BookOpen,
  Braces,
  Bug,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FilePlus,
  FileText,
  Flame,
  Folder,
  FolderOpen,
  Forward,
  Hash,
  History,
  ImageOff,
  Info,
  Link,
  List,
  ListTree,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Settings,
  SquareCheck,
  Sun,
  Tags,
  TriangleAlert,
  X,
  Star,
  StarOff,
  Zap,
} from 'lucide';

type IconNode = Parameters<typeof createElement>[0];

const ICONS: Record<string, IconNode> = {
  'align-left': AlignLeft,
  'arrow-up': ArrowUp,
  'book-open': BookOpen,
  braces: Braces,
  bug: Bug,
  calendar: Calendar,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevrons-down-up': ChevronsDownUp,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'circle-help': CircleHelp,
  'clipboard-list': ClipboardList,
  clock: Clock,
  copy: Copy,
  ellipsis: Ellipsis,
  'external-link': ExternalLink,
  eye: Eye,
  file: File,
  'file-plus': FilePlus,
  'file-text': FileText,
  flame: Flame,
  folder: Folder,
  'folder-open': FolderOpen,
  forward: Forward,
  hash: Hash,
  history: History,
  'image-off': ImageOff,
  info: Info,
  link: Link,
  list: List,
  'list-tree': ListTree,
  monitor: Monitor,
  moon: Moon,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  pencil: Pencil,
  plus: Plus,
  quote: Quote,
  'refresh-cw': RefreshCw,
  search: Search,
  settings: Settings,
  'square-check': SquareCheck,
  sun: Sun,
  tags: Tags,
  'triangle-alert': TriangleAlert,
  x: X,
  star: Star,
  'star-off': StarOff,
  zap: Zap,
};

export function icon(name: string, size = 18): SVGElement {
  return createElement(ICONS[name] ?? File, {
    width: size,
    height: size,
    'stroke-width': size <= 14 ? 2.2 : 2,
    class: `svg-icon lucide-${name}`,
    'aria-hidden': 'true',
  });
}

export function setIcon(el: Element, name: string, size?: number): void {
  el.replaceChildren(icon(name, size));
}

/** Remplit les `<span data-icon="…">` produits par le rendu Rust. */
export function fillIcons(root: ParentNode, size = 16): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (!el.firstChild) setIcon(el, el.dataset.icon ?? 'file', size);
  });
}

/** Boutons de fenêtre façon Windows 11 (traits fins de 10 px). */
export function windowControlIcon(kind: 'minimize' | 'maximize' | 'restore' | 'close'): string {
  const paths = {
    minimize: '<path d="M0 5h10"/>',
    maximize: '<rect x="0.5" y="0.5" width="9" height="9" rx="1"/>',
    restore: '<rect x="0.5" y="2.5" width="7" height="7" rx="1"/><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/>',
    close: '<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>',
  };
  return `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">${paths[kind]}</svg>`;
}
