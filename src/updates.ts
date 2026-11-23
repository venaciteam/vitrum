// Mises à jour : Vitrum lit `latest.json` dans les publications GitHub du dépôt. Une nouvelle version
// se signale par une icône dans la barre de gauche (au-dessus du thème et des réglages) ; un clic ouvre
// un menu : installer, voir les nouveautés ou ignorer cette version. Une version ignorée ne se signale
// plus, mais reste installable depuis les Paramètres. L'installation enregistre tout, télécharge
// (signature vérifiée par le cœur), installe et redémarre ; sous Windows, l'installateur ferme Vitrum
// lui-même et le relance à la fin.
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { errorMessage, isTauri } from './api';
import { settings, updateSettings } from './settings';
import { el, iconButton, Menu, notice } from './ui';

const RELEASES = 'https://github.com/venaciteam/vitrum/releases';
/** Première vérification peu après le lancement, puis toutes les six heures. */
const FIRST_CHECK = 5_000;
const INTERVAL = 6 * 3600_000;

export interface UpdateHost {
  /** Enregistre tout avant l'installation ; faux = la personne a annulé. */
  prepareForUpdate(): Promise<boolean>;
}

type Phase = 'download' | 'install';

/** La mise à jour trouvée : la vraie (Tauri) ou une fausse pour `npm run dev` (adresse avec `?maj`). */
export interface AvailableUpdate {
  version: string;
  current: string;
  install(progress: (phase: Phase, fraction: number | null) => void): Promise<void>;
}

function fromTauri(update: Update): AvailableUpdate {
  return {
    version: update.version,
    current: update.currentVersion,
    async install(progress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          progress('download', total ? 0 : null);
        } else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          progress('download', total ? Math.min(1, done / total) : null);
        } else {
          progress('install', null);
        }
      });
    },
  };
}

function demo(): AvailableUpdate {
  return {
    version: '9.9.9',
    current: '0.0.0',
    async install(progress) {
      for (let i = 0; i <= 20; i++) {
        progress('download', i / 20);
        await new Promise((r) => setTimeout(r, 100));
      }
      progress('install', null);
      await new Promise((r) => setTimeout(r, 800));
      throw new Error('démonstration, rien n’est installé');
    },
  };
}

export class Updater {
  /** Dernière version trouvée, même ignorée (les Paramètres la proposent toujours). */
  available: AvailableUpdate | null = null;
  installing = false;
  /** Bouton de la barre de gauche, caché tant qu'il n'y a rien à signaler. */
  readonly button: HTMLButtonElement;
  private checking = false;
  private listeners = new Set<() => void>();

  constructor(private host: UpdateHost) {
    this.button = iconButton('circle-arrow-down', 'Mise à jour disponible', () => this.showMenu());
    this.button.classList.add('ribbon-update');
    this.button.hidden = true;
  }

  start(): void {
    if (isTauri) {
      // Menu « Vitrum › Rechercher les mises à jour… » du Mac : ouvre directement le menu si une version existe.
      void listen('maj-verifier', () => void this.check(true).then(() => this.available && this.showMenu()));
      window.setTimeout(() => this.auto(), FIRST_CHECK);
      window.setInterval(() => this.auto(), INTERVAL);
    } else if (new URLSearchParams(location.search).has('maj')) {
      this.found(demo(), false);
    }
  }

  /** Prévient (Paramètres ouverts…) quand l'état change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.listeners.forEach((fn) => fn());
  }

  private auto(): void {
    if (settings.checkUpdates) void this.check(false);
  }

  /** `manual` : répond dans tous les cas (à jour, erreur) et signale même une version ignorée. */
  async check(manual: boolean): Promise<void> {
    if (this.checking || this.installing) return;
    if (!isTauri) {
      if (manual) this.found(demo(), true);
      return;
    }
    this.checking = true;
    this.changed();
    try {
      const update = await check({ timeout: 30_000 });
      if (update) this.found(fromTauri(update), manual);
      else {
        this.available = null;
        this.button.hidden = true;
        if (manual) notice('Vitrum est à jour.');
      }
    } catch (e) {
      if (manual) notice(`Impossible de vérifier les mises à jour : ${errorMessage(e)}`, 7000);
    } finally {
      this.checking = false;
      this.changed();
    }
  }

  get isChecking(): boolean {
    return this.checking;
  }

  private found(update: AvailableUpdate, manual: boolean): void {
    this.available = update;
    const skipped = update.version === settings.skippedVersion;
    this.button.hidden = skipped && !manual;
    const label = `Vitrum ${update.version} est disponible`;
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.changed();
  }

  private showMenu(): void {
    const update = this.available;
    if (!update || this.installing) return;
    const head = el('div', 'menu-update-head');
    head.append(
      el('div', 'menu-update-title', `Vitrum ${update.version} est disponible`),
      el('div', 'menu-update-text', `Version installée : ${update.current}`),
    );
    const menu = new Menu()
      .addCustom(head)
      .addSeparator()
      .addItem({ title: 'Installer et redémarrer', icon: 'download', onClick: () => void this.install() })
      .addItem({ title: 'Voir les nouveautés', icon: 'external-link', onClick: () => this.openNotes() })
      .addSeparator()
      .addItem({ title: 'Ignorer cette version', icon: 'x', onClick: () => this.skip() });
    const r = this.button.getBoundingClientRect();
    menu.show(r.right + 6, r.top);
  }

  openNotes(): void {
    if (!this.available) return;
    const url = `${RELEASES}/tag/v${this.available.version}`;
    if (isTauri) openUrl(url).catch((e) => notice(errorMessage(e)));
  }

  private skip(): void {
    if (!this.available) return;
    updateSettings({ skippedVersion: this.available.version });
    this.button.hidden = true;
    notice('Version ignorée : elle reste installable depuis les Paramètres, section « Mises à jour ».', 6000);
    this.changed();
  }

  async install(): Promise<void> {
    const update = this.available;
    if (!update || this.installing) return;
    if (!(await this.host.prepareForUpdate())) return;
    this.installing = true;
    this.button.hidden = false;
    this.button.classList.add('is-busy');
    this.changed();
    const status = el('div', 'notice update-status');
    document.getElementById('notices')?.append(status);
    try {
      await update.install((phase, fraction) => {
        const pct = fraction === null ? '' : ` ${Math.round(fraction * 100)} %`;
        status.textContent =
          phase === 'install' ? `Installation de Vitrum ${update.version}…` : `Téléchargement de Vitrum ${update.version}…${pct}`;
        this.button.title = status.textContent;
      });
      status.textContent = 'Redémarrage…';
      if (isTauri) await relaunch();
    } catch (e) {
      status.remove();
      notice(`La mise à jour a échoué : ${errorMessage(e)}`, 8000);
      this.installing = false;
      this.button.classList.remove('is-busy');
      this.button.hidden = update.version === settings.skippedVersion;
      this.button.title = `Vitrum ${update.version} est disponible`;
      this.changed();
    }
  }

  /** Ligne « Mise à jour » des Paramètres, tenue à jour tant qu'elle est affichée. */
  settingsRow(row: (name: string, desc: string, control: HTMLElement) => HTMLElement, beforeInstall: () => void): HTMLElement {
    const box = el('div');
    const render = () => {
      const update = this.available;
      const buttons = el('div', 'setting-buttons');
      let desc = '';
      if (this.installing) {
        desc = `Installation de Vitrum ${update?.version ?? ''} en cours…`;
      } else if (update) {
        desc =
          update.version === settings.skippedVersion
            ? `Vitrum ${update.version} est disponible (version ignorée). Vous avez la ${update.current}.`
            : `Vitrum ${update.version} est disponible. Vous avez la ${update.current}.`;
        const notes = el('button', '', 'Nouveautés');
        notes.addEventListener('click', () => this.openNotes());
        const install = el('button', 'mod-cta', 'Installer et redémarrer');
        install.addEventListener('click', () => {
          beforeInstall();
          void this.install();
        });
        buttons.append(notes, install);
      } else {
        const checkNow = el('button', '', this.checking ? 'Recherche…' : 'Rechercher maintenant');
        checkNow.disabled = this.checking;
        checkNow.addEventListener('click', () => void this.check(true));
        buttons.append(checkNow);
      }
      box.replaceChildren(row(update ? 'Mise à jour disponible' : 'Vérifier tout de suite', desc, buttons));
    };
    render();
    const stop = this.onChange(() => (box.isConnected ? render() : stop()));
    return box;
  }
}
