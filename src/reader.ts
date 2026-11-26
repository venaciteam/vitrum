// Mode lecture : finitions du HTML produit par le cœur Rust (icônes des
// callouts, diagrammes Mermaid, formules, coloration du code, cases à cocher).
import { fillIcons, icon, setIcon } from './icons';
import { isDark } from './settings';
import { copyText, el, notice } from './ui';

const CALLOUT_ICONS: Record<string, string> = {
  note: 'pencil',
  abstract: 'clipboard-list',
  summary: 'clipboard-list',
  tldr: 'clipboard-list',
  info: 'info',
  todo: 'circle-check',
  tip: 'flame',
  hint: 'flame',
  important: 'flame',
  success: 'check',
  check: 'check',
  done: 'check',
  question: 'circle-help',
  help: 'circle-help',
  faq: 'circle-help',
  warning: 'triangle-alert',
  caution: 'triangle-alert',
  attention: 'triangle-alert',
  failure: 'x',
  fail: 'x',
  missing: 'x',
  danger: 'zap',
  error: 'zap',
  bug: 'bug',
  example: 'list',
  quote: 'quote',
  cite: 'quote',
};

export interface ReaderContext {
  /** Case cochée/décochée : numéro de ligne (1 = première) dans le source. */
  toggleTask: (line: number) => void;
}

export async function enhance(root: HTMLElement, ctx: ReaderContext): Promise<void> {
  fillIcons(root);
  callouts(root);
  tasks(root, ctx);
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    if (/^(https?:|mailto:)/i.test(a.getAttribute('href') ?? '') && !a.classList.contains('tag')) {
      a.classList.add('external-link');
    }
  });
  await Promise.all([math(root), code(root)]);
}

function callouts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.callout[data-callout]').forEach((callout) => {
    const title = callout.querySelector<HTMLElement>(':scope > .callout-title');
    if (!title || title.querySelector('.callout-title-inner')) return;
    const inner = el('div', 'callout-title-inner');
    inner.append(...Array.from(title.childNodes));
    // Un éventuel paragraphe isolé dans le titre ne doit pas ajouter de marges.
    if (inner.children.length === 1 && inner.firstElementChild?.tagName === 'P') {
      inner.firstElementChild.replaceWith(...Array.from(inner.firstElementChild.childNodes));
    }
    const iconEl = el('div', 'callout-icon');
    setIcon(iconEl, CALLOUT_ICONS[callout.dataset.callout ?? ''] ?? 'pencil');
    title.append(iconEl, inner);

    const fold = callout.dataset.calloutFold;
    if (fold === 'collapsed' || fold === 'expanded') {
      callout.classList.add('is-collapsible');
      if (fold === 'collapsed') callout.classList.add('is-collapsed');
      const foldEl = el('div', 'callout-fold');
      foldEl.append(icon('chevron-down'));
      title.append(foldEl);
      title.addEventListener('click', (e) => {
        if ((e.target as Element).closest('a')) return;
        callout.classList.toggle('is-collapsed');
      });
    }
  });
}

function tasks(root: HTMLElement, ctx: ReaderContext): void {
  root.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach((box) => {
    box.disabled = false;
    const li = box.closest<HTMLElement>('li');
    if (box.checked) li?.classList.add('is-checked');
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const line = Number((li?.dataset.sourcepos ?? box.dataset.sourcepos ?? '').split(':')[0]);
      if (line > 0) ctx.toggleTask(line);
    });
  });
}

async function math(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>('[data-math-style]');
  if (!nodes.length) return;
  const [{ default: katex }] = await Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
    import('katex/contrib/mhchem'),
  ]);
  nodes.forEach((node) => {
    const display = node.dataset.mathStyle === 'display';
    try {
      katex.render(node.textContent ?? '', node, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
    } catch {
      node.classList.add('math-error');
    }
    node.classList.add(display ? 'math-block' : 'math-inline');
  });
}

let hljsPromise: Promise<typeof import('highlight.js').default> | null = null;

async function code(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code'));
  if (!blocks.length) return;
  const jobs: Promise<void>[] = [];
  for (const codeEl of blocks) {
    const pre = codeEl.parentElement as HTMLElement;
    const lang = /language-([\w#+.-]+)/.exec(codeEl.className)?.[1]?.toLowerCase() ?? '';
    if (lang === 'mermaid') {
      jobs.push(mermaid(pre, codeEl.textContent ?? ''));
      continue;
    }
    addCopyButton(pre, codeEl);
    if (lang) {
      jobs.push(
        (hljsPromise ??= import('highlight.js/lib/common').then((m) => m.default)).then((hljs) => {
          if (hljs.getLanguage(lang)) {
            hljs.highlightElement(codeEl);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
}

function addCopyButton(pre: HTMLElement, codeEl: HTMLElement): void {
  const btn = el('button', 'copy-code-button');
  btn.setAttribute('aria-label', 'Copier');
  btn.append(icon('copy', 15));
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyText(codeEl.textContent ?? '');
    notice('Copié dans le presse-papiers', 1500);
  });
  pre.append(btn);
}

type Mermaid = typeof import('mermaid').default;
let mermaidPromise: Promise<Mermaid> | null = null;
let mermaidTheme = '';
let mermaidCount = 0;

async function mermaid(pre: HTMLElement, source: string): Promise<void> {
  const m = await (mermaidPromise ??= import('mermaid').then((x) => x.default));
  // Clair : « neutral » (cases grises) plutôt que « default », dont le lavande rappelait l'ancien
  // accent violet ; c'est l'équivalent clair du thème sombre.
  const theme = isDark() ? 'dark' : 'neutral';
  if (theme !== mermaidTheme) {
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true });
    mermaidTheme = theme;
  }
  const id = `vitrum-mermaid-${++mermaidCount}`;
  const box = el('div', 'mermaid');
  if (pre.dataset.sourcepos) box.dataset.sourcepos = pre.dataset.sourcepos;
  try {
    const { svg, bindFunctions } = await m.render(id, source);
    box.innerHTML = svg;
    bindFunctions?.(box);
  } catch (err) {
    box.className = 'mermaid-error';
    box.append(el('div', 'mermaid-error-title', 'Diagramme Mermaid invalide'));
    box.append(el('pre', undefined, err instanceof Error ? err.message : String(err)));
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
  pre.replaceWith(box);
}

/** Élément du rendu correspondant à une ligne du source (le plus proche avant). */
export function elementForLine(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -1;
  root.querySelectorAll<HTMLElement>('[data-sourcepos]').forEach((node) => {
    const start = Number(node.dataset.sourcepos?.split(':')[0]);
    if (start <= line && start > bestLine) {
      best = node;
      bestLine = start;
    }
  });
  return best;
}

// --- Correspondance position à l'écran ↔ ligne du source ---
// Une « ligne » est fractionnaire : 12.5 = à mi-hauteur de la ligne 12. Chaque
// bloc rendu couvre les lignes [début, fin + 1[ de son attribut data-sourcepos,
// réparties sur sa hauteur.

const INLINE_TAGS = new Set(['A', 'EM', 'STRONG', 'CODE', 'SPAN', 'DEL', 'S', 'MARK', 'IMG', 'SUP', 'SUB', 'U', 'KBD', 'BR', 'INPUT']);

interface Block {
  start: number;
  end: number;
  rect: DOMRect;
}

function blocks(root: HTMLElement): Block[] {
  const out: Block[] = [];
  root.querySelectorAll<HTMLElement>('[data-sourcepos]').forEach((node) => {
    if (INLINE_TAGS.has(node.tagName)) return;
    const m = /^(\d+):\d+-(\d+):(\d+)/.exec(node.dataset.sourcepos ?? '');
    if (!m) return;
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0) return;
    const start = Number(m[1]);
    // « 40:0 » : le bloc s'arrête au tout début de la ligne 40 (ligne vide après une liste).
    const end = Number(m[3]) === 0 ? Number(m[2]) - 1 : Number(m[2]);
    out.push({ start, end: Math.max(start, end), rect });
  });
  return out;
}

/** Plus petit bloc qui contient le critère ; à égalité, le plus imbriqué (le dernier). */
function narrowest(list: Block[], keep: (b: Block) => boolean): Block | null {
  let best: Block | null = null;
  for (const b of list) {
    if (keep(b) && (!best || b.end - b.start <= best.end - best.start)) best = b;
  }
  return best;
}

/**
 * Ligne du source affichée à la hauteur `y` (coordonnées de la fenêtre). Entre
 * deux blocs (marges), le repère devient le haut du bloc suivant : c'est lui
 * qu'on a sous les yeux, et c'est lui qu'il faut garder à sa place.
 */
export function lineAtY(root: HTMLElement, y: number): { line: number; y: number } {
  const list = blocks(root);
  const hit = narrowest(list, (b) => b.rect.top <= y && y < b.rect.bottom);
  if (hit) return { line: hit.start + ((y - hit.rect.top) / hit.rect.height) * (hit.end - hit.start + 1), y };
  let next: Block | null = null;
  let prev: Block | null = null;
  for (const b of list) {
    if (b.rect.top > y && (!next || b.rect.top < next.rect.top || (b.rect.top === next.rect.top && b.end - b.start < next.end - next.start))) next = b;
    if (b.rect.bottom <= y && (!prev || b.rect.bottom > prev.rect.bottom)) prev = b;
  }
  if (next) return { line: next.start, y: next.rect.top };
  if (prev) return { line: prev.end + 1, y: prev.rect.bottom };
  return { line: 1, y };
}

/** Hauteur (coordonnées de la fenêtre) où s'affiche la ligne `line` du source. */
export function yForLine(root: HTMLElement, line: number): number | null {
  const list = blocks(root);
  const n = Math.floor(line);
  const hit = narrowest(list, (b) => b.start <= n && n <= b.end);
  if (hit) return hit.rect.top + ((line - hit.start) / (hit.end - hit.start + 1)) * hit.rect.height;
  let prev: Block | null = null;
  let next: Block | null = null;
  for (const b of list) {
    if (b.end < n && (!prev || b.end > prev.end || (b.end === prev.end && b.rect.bottom > prev.rect.bottom))) prev = b;
    if (b.start > n && (!next || b.start < next.start || (b.start === next.start && b.rect.top < next.rect.top))) next = b;
  }
  if (prev && next) {
    const from = prev.end + 1;
    const lines = next.start - from;
    return prev.rect.bottom + (lines > 0 ? (line - from) / lines : 0) * (next.rect.top - prev.rect.bottom);
  }
  if (next) return next.rect.top;
  if (prev) return prev.rect.bottom;
  return null;
}

export function scrollToElement(scroller: HTMLElement, target: Element, margin = 24): void {
  const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += delta - margin;
}

/** `[[#Titre]]` ou ancre `#titre` : cherche le titre par identifiant ou par texte. */
export function findHeading(root: HTMLElement, anchor: string): HTMLElement | null {
  const wanted = decodeURIComponent(anchor.replace(/^#\^?/, '')).trim();
  if (!wanted) return null;
  const byId = root.querySelector<HTMLElement>(`[id="${CSS.escape(wanted)}"]`);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  return (
    Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).find(
      (h) => (h.textContent ?? '').trim().toLowerCase() === lower,
    ) ?? null
  );
}
