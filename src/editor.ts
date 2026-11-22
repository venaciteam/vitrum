// Mode édition : CodeMirror 6 (comme Obsidian) avec le Markdown brut coloré.
import { Annotation, Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { settings } from './settings';

/** Marque les changements venus du disque (pas une saisie : pas d'enregistrement). */
export const fromDisk = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-header cm-header-1' },
  { tag: t.heading2, class: 'cm-header cm-header-2' },
  { tag: t.heading3, class: 'cm-header cm-header-3' },
  { tag: t.heading4, class: 'cm-header cm-header-4' },
  { tag: t.heading5, class: 'cm-header cm-header-5' },
  { tag: t.heading6, class: 'cm-header cm-header-6' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strikethrough' },
  { tag: t.link, class: 'cm-link' },
  { tag: t.url, class: 'cm-url' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: [t.processingInstruction, t.escape], class: 'cm-formatting' },
  { tag: t.contentSeparator, class: 'cm-hr' },
  { tag: t.labelName, class: 'cm-label' },
  { tag: t.comment, class: 'cm-comment' },
  { tag: t.meta, class: 'cm-meta' },
  { tag: t.atom, class: 'cm-atom' },
  // Code dans les blocs ``` et propriétés YAML.
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], class: 'cm-code-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'cm-code-string' },
  { tag: [t.number, t.bool, t.null, t.unit], class: 'cm-code-value' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'cm-code-function' },
  { tag: [t.propertyName, t.attributeName], class: 'cm-code-property' },
  { tag: [t.typeName, t.className, t.namespace], class: 'cm-code-type' },
  { tag: [t.operator, t.derefOperator], class: 'cm-code-operator' },
  { tag: [t.tagName, t.angleBracket], class: 'cm-code-tag' },
  { tag: [t.definition(t.variableName), t.self], class: 'cm-code-def' },
  { tag: [t.punctuation, t.separator, t.bracket], class: 'cm-code-punctuation' },
]);

/** Lignes de blocs de code et de titres : fond et taille, comme Obsidian. */
const lineStyles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;
      let last = 0;
      const add = (lineNo: number, cls: string) => {
        if (lineNo <= last) return;
        last = lineNo;
        const line = doc.line(lineNo);
        builder.add(line.from, line.from, Decoration.line({ class: cls }));
      };
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
              const first = doc.lineAt(node.from).number;
              const end = doc.lineAt(node.to).number;
              for (let l = first; l <= end; l++) {
                let cls = 'cm-codeblock';
                if (l === first) cls += ' cm-codeblock-begin';
                if (l === end) cls += ' cm-codeblock-end';
                add(l, cls);
              }
              return false;
            }
            const m = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
            if (m) {
              add(doc.lineAt(node.from).number, `cm-header-line cm-header-line-${m[1]}`);
              return false;
            }
            return undefined;
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const frenchPhrases = EditorState.phrases.of({
  Find: 'Rechercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'respecter la casse',
  regexp: 'expression régulière',
  'by word': 'mot entier',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'current match': 'occurrence actuelle',
  'on line': 'à la ligne',
  'replaced $ matches': '$ remplacements',
  'replaced match on line $': 'remplacé à la ligne $',
  'Go to line': 'Aller à la ligne',
  go: 'aller',
});

export interface EditorOptions {
  readonly: boolean;
  onChange: () => void;
  onSave: () => void;
}

const editable = new Compartment();
const spelling = new Compartment();

function editableExt(readonly: boolean): Extension {
  return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];
}

function spellExt(): Extension {
  return EditorView.contentAttributes.of({
    spellcheck: settings.spellcheck ? 'true' : 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
    lang: 'fr',
  });
}

function extensions(opts: EditorOptions): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    EditorState.tabSize.of(4),
    indentUnit.of('\t'),
    closeBrackets(),
    yamlFrontmatter({
      content: markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    }),
    syntaxHighlighting(highlight),
    lineStyles,
    highlightSelectionMatches(),
    search({ top: true }),
    frenchPhrases,
    keymap.of([
      { key: 'Mod-s', run: () => (opts.onSave(), true) },
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    editable.of(editableExt(opts.readonly)),
    spelling.of(spellExt()),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) opts.onChange();
    }),
  ];
}

const optionsOf = new WeakMap<EditorView, EditorOptions>();

export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions): EditorView {
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: extensions(opts) }) });
  optionsOf.set(view, opts);
  return view;
}

/** Nouveau document (autre fichier) : historique d'annulation remis à zéro. */
export function resetEditor(view: EditorView, doc: string, readonly: boolean): void {
  const opts = optionsOf.get(view);
  if (!opts) return;
  opts.readonly = readonly;
  view.setState(EditorState.create({ doc, extensions: extensions(opts) }));
}

export function setReadonly(view: EditorView, readonly: boolean): void {
  view.dispatch({ effects: editable.reconfigure(editableExt(readonly)) });
}

export function refreshSpellcheck(view: EditorView): void {
  view.dispatch({ effects: spelling.reconfigure(spellExt()) });
}

/** Remplace le texte par la version du disque en ne touchant que ce qui diffère. */
export function applyDiskText(view: EditorView, text: string): void {
  const old = view.state.doc.toString();
  if (old === text) return;
  let start = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start++;
  let endOld = old.length;
  let endNew = text.length;
  while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
    endOld--;
    endNew--;
  }
  view.dispatch({
    changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
    annotations: fromDisk.of(true),
  });
}

/** Première ligne visible dans le conteneur qui fait défiler l'éditeur. */
/** Ligne (fractionnaire, comme dans reader.ts) affichée à la hauteur `y` de la fenêtre. */
export function editorLineAtY(view: EditorView, y: number): number {
  const height = y - view.documentTop;
  if (height <= 0) return 1;
  const block = view.lineBlockAtHeight(height);
  const line = view.state.doc.lineAt(block.from);
  const frac = block.height > 0 ? (height - block.top) / block.height : 0;
  return line.number + Math.max(0, Math.min(0.999, frac));
}

/**
 * Fait défiler `scroller` pour que la ligne `line` (fractionnaire) arrive à
 * `offset` pixels de son haut. CodeMirror amène d'abord la ligne à l'écran (il
 * mesure alors sa vraie hauteur), puis on corrige au pixel près.
 */
export function scrollEditorLineTo(view: EditorView, scroller: HTMLElement, line: number, offset: number): void {
  const doc = view.state.doc;
  const n = Math.max(1, Math.min(Math.floor(line), doc.lines));
  const from = doc.line(n).from;
  const frac = n === Math.floor(line) ? line - n : 0;
  view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: offset }) });
  const fix = {
    read: (v: EditorView) => {
      const block = v.lineBlockAt(from);
      return v.documentTop + block.top + frac * block.height - (scroller.getBoundingClientRect().top + offset);
    },
    write: (delta: number) => {
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
    },
  };
  view.requestMeasure(fix);
  requestAnimationFrame(() => view.requestMeasure(fix));
}

export function scrollToLine(view: EditorView, line: number, select = false): void {
  const doc = view.state.doc;
  const pos = doc.line(Math.max(1, Math.min(line, doc.lines))).from;
  view.dispatch({
    selection: select ? { anchor: pos } : undefined,
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
  });
}

export function openSearch(view: EditorView): void {
  view.focus();
  openSearchPanel(view);
}
