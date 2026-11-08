// Réglages et session (onglets ouverts, fichiers récents), gardés dans le
// stockage local de la fenêtre.

export type Mode = 'preview' | 'source';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  readableLineLength: boolean;
  defaultMode: Mode;
  autosave: boolean;
  spellcheck: boolean;
  strictLineBreaks: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
}

const DEFAULTS: Settings = {
  theme: 'system',
  fontSize: 16,
  readableLineLength: true,
  defaultMode: 'preview',
  autosave: true,
  spellcheck: false,
  strictLineBreaks: false,
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
  document.body.style.setProperty('--font-text-size', `${settings.fontSize}px`);
}

darkQuery.addEventListener('change', () => {
  if (settings.theme === 'system') {
    applyAppearance();
    listeners.forEach((fn) => fn({ theme: settings.theme }));
  }
});
