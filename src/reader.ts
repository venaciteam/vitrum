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
  const theme = isDark() ? 'dark' : 'default';
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

/** Ligne du source affichée en haut de la vue de lecture. */
export function topLine(root: HTMLElement, scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-sourcepos]'))) {
    const r = node.getBoundingClientRect();
    if (r.height > 0 && r.bottom > top + 4) return Number(node.dataset.sourcepos?.split(':')[0]) || 1;
  }
  return 1;
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
