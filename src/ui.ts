// Composants d'interface façon Obsidian : notifications, menus, fenêtres modales.
import { icon } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function iconButton(name: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', 'clickable-icon');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

// --- Notifications (coin supérieur droit) ---

export function notice(message: string, timeout = 4500): void {
  const container = document.getElementById('notices');
  if (!container) return;
  const n = el('div', 'notice', message);
  n.addEventListener('click', () => n.remove());
  container.append(n);
  if (timeout > 0) setTimeout(() => n.remove(), timeout);
}

// --- Menus contextuels ---

export interface MenuItem {
  title: string;
  icon?: string;
  onClick: () => void;
  checked?: boolean;
  disabled?: boolean;
  warning?: boolean;
}

let openMenu: Menu | null = null;

export class Menu {
  private items: (MenuItem | 'separator')[] = [];
  private dom: HTMLElement | null = null;
  private cleanup: (() => void) | null = null;

  addItem(item: MenuItem): this {
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    if (this.items.length && this.items[this.items.length - 1] !== 'separator') this.items.push('separator');
    return this;
  }

  showAtMouse(e: MouseEvent): void {
    e.preventDefault();
    this.show(e.clientX, e.clientY);
  }

  showBelow(anchor: HTMLElement, alignRight = false): void {
    const r = anchor.getBoundingClientRect();
    this.show(alignRight ? r.right : r.left, r.bottom + 4, alignRight);
  }

  show(x: number, y: number, alignRight = false): void {
    openMenu?.hide();
    openMenu = this;
    const menu = el('div', 'menu');
    for (const item of this.items) {
      if (item === 'separator') {
        menu.append(el('div', 'menu-separator'));
        continue;
      }
      const row = el('div', 'menu-item');
      if (item.disabled) row.classList.add('is-disabled');
      if (item.warning) row.classList.add('is-warning');
      const ic = el('div', 'menu-item-icon');
      if (item.checked) ic.append(icon('check', 16));
      else if (item.icon) ic.append(icon(item.icon, 16));
      row.append(ic, el('div', 'menu-item-title', item.title));
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (item.disabled) return;
        this.hide();
        item.onClick();
      });
      menu.append(row);
    }
    document.body.append(menu);
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(alignRight ? x - width : x, window.innerWidth - width - 4));
    const top = y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.dom = menu;

    const onDown = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) this.hide();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') this.hide();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', this.hideBound);
    });
    this.cleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', this.hideBound);
    };
  }

  private hideBound = () => this.hide();

  hide(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.dom?.remove();
    this.dom = null;
    if (openMenu === this) openMenu = null;
  }
}

// --- Fenêtres modales ---

export function openModal(title: string, build: (content: HTMLElement, close: () => void) => void): () => void {
  const backdrop = el('div', 'modal-container');
  const bg = el('div', 'modal-bg');
  const modal = el('div', 'modal');
  const closeBtn = el('div', 'modal-close-button');
  closeBtn.append(icon('x'));
  const titleEl = el('div', 'modal-title', title);
  const content = el('div', 'modal-content');
  modal.append(closeBtn, titleEl, content);
  backdrop.append(bg, modal);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  };
  bg.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  build(content, close);
  document.body.append(backdrop);
  return close;
}

export function settingRow(name: string, desc: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'setting-item');
  const info = el('div', 'setting-item-info');
  info.append(el('div', 'setting-item-name', name));
  if (desc) info.append(el('div', 'setting-item-description', desc));
  const ctl = el('div', 'setting-item-control');
  ctl.append(control);
  row.append(info, ctl);
  return row;
}

export function toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const t = el('div', 'checkbox-container');
  t.classList.toggle('is-enabled', value);
  t.setAttribute('role', 'switch');
  t.addEventListener('click', () => {
    const v = !t.classList.contains('is-enabled');
    t.classList.toggle('is-enabled', v);
    onChange(v);
  });
  return t;
}

export function dropdown<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el('select', 'dropdown');
  for (const [v, label] of options) {
    const o = el('option', undefined, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
