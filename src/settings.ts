// Réglages et session (onglets ouverts, fichiers récents), gardés dans le
// stockage local de la fenêtre.

export type Mode = 'preview' | 'source';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  /** Grossissement du contenu des notes (1 = 100 %), en plus de la taille du texte. */
  zoom: number;
  readableLineLength: boolean;
  defaultMode: Mode;
  autosave: boolean;
  spellcheck: boolean;
  strictLineBreaks: boolean;
  /** Recherche des mises à jour au lancement et toutes les six heures. */
  checkUpdates: boolean;
  /** Version écartée par « Ignorer cette version » : plus signalée, mais installable depuis les Paramètres. */
  skippedVersion: string;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
}

const DEFAULTS: Settings = {
  theme: 'system',
  fontSize: 16,
  zoom: 1,
  readableLineLength: true,
  defaultMode: 'preview',
  autosave: true,
  spellcheck: false,
  strictLineBreaks: false,
  checkUpdates: true,
  skippedVersion: '',
  leftOpen: true,
  rightOpen: false,
  leftWidth: 260,
  rightWidth: 260,
};

export interface Session {
  tabs: { path: string | null; mode: Mode }[];
  active: number;
  recent: string[];
  explorerRoot: string | null;
  /** Dossier choisi à la main (sinon l'explorateur suit la note active). */
  explorerPinned: boolean;
  /** Dossiers favoris du panneau de fichiers (propres à chaque machine). */
  favorites: string[];
}

function load<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // stockage indisponible : valeurs par défaut
  }
  return { ...defaults };
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : tant pis
  }
}

export const settings: Settings = load('vitrum.settings', DEFAULTS);
export const session: Session = load<Session>('vitrum.session', {
  tabs: [],
  active: 0,
  recent: [],
  explorerRoot: null,
  explorerPinned: false,
  favorites: [],
});

const listeners = new Set<(changed: Partial<Settings>) => void>();

export function onSettingsChange(fn: (changed: Partial<Settings>) => void): void {
  listeners.add(fn);
}

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  store('vitrum.settings', settings);
  applyAppearance();
  listeners.forEach((fn) => fn(patch));
}

export function saveSession(): void {
  store('vitrum.session', session);
}

export function addRecent(path: string): void {
  session.recent = [path, ...session.recent.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 15);
  saveSession();
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function isDark(): boolean {
  return settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches);
}

export function applyAppearance(): void {
  const dark = isDark();
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  document.body.classList.toggle('readable-line-length', settings.readableLineLength);
  applyZoom();
}

// --- Zoom du contenu ---

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
/** Paliers des raccourcis et de la molette, comme dans un navigateur. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function applyZoom(): void {
  const style = document.body.style;
  style.setProperty('--font-text-size', `${settings.fontSize}px`);
  // Agrandissement de la note entière (voir .markdown-preview-sizer dans layout.css).
  style.setProperty('--content-zoom', String(settings.zoom));
}

let zoomStoreTimer = 0;

/** Change le zoom sans prévenir les autres réglages (appelé à chaque image d'un pincement). */
export function setZoom(zoom: number): number {
  const z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)) * 100) / 100;
  if (z === settings.zoom) return z;
  settings.zoom = z;
  applyZoom();
  clearTimeout(zoomStoreTimer);
  zoomStoreTimer = window.setTimeout(() => store('vitrum.settings', settings), 400);
  return z;
}

export function nextZoom(direction: 1 | -1): number {
  const z = settings.zoom;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN;
}

darkQuery.addEventListener('change', () => {
  if (settings.theme === 'system') {
    applyAppearance();
    listeners.forEach((fn) => fn({ theme: settings.theme }));
  }
});
