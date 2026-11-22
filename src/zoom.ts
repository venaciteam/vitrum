// Zoom du contenu des notes (texte, titres, tableaux…), sans toucher à
// l'interface : raccourcis ⌘/Ctrl + = − 0, pincement du trackpad, Ctrl + molette
// et menu « Présentation » du Mac. Identique sur macOS et Windows.
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './api';
import { nextZoom, setZoom, settings, ZOOM_MAX, ZOOM_MIN } from './settings';
import { el } from './ui';

export type ZoomAction = 'in' | 'out' | 'reset';

export interface ZoomTarget {
  /** Applique `change` en gardant sous les yeux le texte affiché à la hauteur `y`. */
  zoomAround(change: () => void, y?: number): void;
}

/** Raccourci clavier de zoom (⌘ ou Ctrl déjà vérifié), quelle que soit la disposition du clavier. */
export function zoomKey(e: KeyboardEvent): ZoomAction | null {
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.code === 'NumpadSubtract') return 'out';
  // AZERTY : le 0 est sous le « à », sans Maj (« à » seul aussi, pour les touches simulées
  // sans code physique, comme celles d'un Stream Deck).
  if (e.key === '0' || e.key === 'à' || e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}

export function zoomLabel(z = settings.zoom): string {
  return `${Math.round(z * 100)} %`;
}

const clamp = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export class ZoomController {
  private indicator = el('div', 'zoom-indicator');
  private hideTimer = 0;
  private last = { source: '', at: 0 };
  /** Valeur non arrondie pendant un geste continu (pincement, pavé tactile). */
  private live: number | null = null;
  private liveTimer = 0;
  private gestureStart: number | null = null;
  private pending: { zoom: number; y?: number } | null = null;
  private frame = 0;
  private listeners = new Set<() => void>();

  constructor(private target: ZoomTarget) {
    document.body.append(this.indicator);
    this.bindPointer();
    if (isTauri) {
      void listen<string>('zoom', (e) => {
        const action = e.payload.replace(/^zoom-/, '') as ZoomAction;
        if (action === 'in' || action === 'out' || action === 'reset') this.run(action, 'menu');
      });
    }
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Zoom avant, arrière ou retour à 100 %. */
  run(action: ZoomAction, source = 'key'): void {
    // Sur Mac, le menu et la page peuvent voir le même raccourci : on n'en garde qu'un.
    const now = performance.now();
    if (this.last.source && this.last.source !== source && now - this.last.at < 150) return;
    this.last = { source, at: now };
    this.live = null;
    // Un pincement encore en attente ne doit pas annuler ce choix.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = null;
    this.apply(action === 'reset' ? 1 : nextZoom(action === 'in' ? 1 : -1));
  }

  set(zoom: number): void {
    this.live = null;
    this.apply(clamp(zoom));
  }

  private apply(zoom: number, y?: number): void {
    // Près de 100 % pendant un geste : on s'y aimante.
    const z = Math.abs(zoom - 1) < 0.03 ? 1 : zoom;
    const before = settings.zoom;
    this.target.zoomAround(() => setZoom(z), y);
    this.show();
    if (settings.zoom !== before) this.listeners.forEach((fn) => fn());
  }

  /** Gestes continus : une mise à jour par image affichée. */
  private schedule(zoom: number, y?: number): void {
    this.pending = { zoom, y };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const p = this.pending;
      this.pending = null;
      if (p) this.apply(p.zoom, p.y);
    });
  }

  private continuous(factor: number, y: number): void {
    this.live = clamp((this.live ?? settings.zoom) * factor);
    clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => (this.live = null), 400);
    this.schedule(this.live, y);
  }

  private bindPointer(): void {
    // Ctrl + molette (souris) et pincement du pavé tactile sous Windows, qui
    // arrive comme une molette avec Ctrl.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        if (this.gestureStart !== null) return;
        const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
        if (notch) {
          this.live = null;
          this.apply(nextZoom(e.deltaY < 0 ? 1 : -1), e.clientY);
        } else if (e.deltaY) {
          this.continuous(Math.exp(-e.deltaY / 100), e.clientY);
        }
      },
      { passive: false },
    );

    // Pincement du trackpad sur Mac (événements propres à WebKit).
    type Gesture = Event & { scale: number; clientY: number };
    window.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      this.gestureStart = settings.zoom;
    });
    window.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const g = e as Gesture;
      if (this.gestureStart === null || !g.scale) return;
      this.schedule(clamp(this.gestureStart * g.scale), g.clientY);
    });
    window.addEventListener('gestureend', (e) => {
      e.preventDefault();
      this.gestureStart = null;
    });
  }

  private show(): void {
    this.indicator.textContent = `Zoom : ${zoomLabel()}`;
    this.indicator.classList.add('is-visible');
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.indicator.classList.remove('is-visible'), 1200);
  }
}
