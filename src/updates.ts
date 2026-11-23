// Mises à jour : Vitrum lit `latest.json` dans les publications GitHub du dépôt, propose la nouvelle
// version dans une carte en bas à droite, la télécharge (signature vérifiée par le cœur), l'installe
// et redémarre. Sous Windows, l'installateur ferme Vitrum lui-même et le relance à la fin.
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { errorMessage, isTauri } from './api';
import { settings } from './settings';
import { el, notice } from './ui';

const RELEASES = 'https://github.com/venaciteam/vitrum/releases';
/** Première vérification peu après le lancement, puis toutes les six heures. */
const FIRST_CHECK = 5_000;
const INTERVAL = 6 * 3600_000;

export interface UpdateHost {
  /** Enregistre tout avant l'installation ; faux = la personne a annulé. */
  prepareForUpdate(): Promise<boolean>;
}

type Phase = 'download' | 'install';

/** La mise à jour proposée : la vraie (Tauri) ou une fausse pour `npm run dev` (adresse avec `?maj`). */
interface Pending {
  version: string;
  current: string;
  install(progress: (phase: Phase, fraction: number | null) => void): Promise<void>;
}

function fromTauri(update: Update): Pending {
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

function demo(): Pending {
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
  private card: HTMLElement | null = null;
  /** Version écartée par « Plus tard » : plus proposée d'elle-même jusqu'au prochain lancement. */
  private postponed: string | null = null;
  private checking = false;

  constructor(private host: UpdateHost) {}

  start(): void {
    if (isTauri) {
      void listen('maj-verifier', () => void this.check(true));
      window.setTimeout(() => this.auto(), FIRST_CHECK);
      window.setInterval(() => this.auto(), INTERVAL);
    } else if (new URLSearchParams(location.search).has('maj')) {
      this.offer(demo());
    }
  }

  private auto(): void {
    if (settings.checkUpdates) void this.check(false);
  }

  /** `manual` : répond dans tous les cas (à jour, erreur). Sinon, silence sauf nouvelle version. */
  async check(manual: boolean): Promise<void> {
    if (this.card) {
      if (manual) this.card.classList.add('is-flashing');
      return;
    }
    if (!isTauri) {
      if (manual) this.offer(demo());
      return;
    }
    if (this.checking) return;
    this.checking = true;
    try {
      const update = await check({ timeout: 30_000 });
      if (!update) {
        if (manual) notice('Vitrum est à jour.');
      } else if (manual || update.version !== this.postponed) {
        this.offer(fromTauri(update));
      }
    } catch (e) {
      if (manual) notice(`Impossible de vérifier les mises à jour : ${errorMessage(e)}`, 7000);
    } finally {
      this.checking = false;
    }
  }

  private offer(update: Pending): void {
    const card = el('div', 'update-card');
    card.setAttribute('role', 'status');
    const title = el('div', 'update-title', `Vitrum ${update.version} est disponible`);
    const text = el('div', 'update-text', `Version installée : ${update.current}.`);
    const bar = el('div', 'update-bar');
    const progress = el('div', 'update-progress');
    progress.append(bar);
    const buttons = el('div', 'update-buttons');
    const news = el('button', '', 'Nouveautés');
    const later = el('button', '', 'Plus tard');
    const install = el('button', 'mod-cta', 'Installer et redémarrer');
    buttons.append(news, later, install);
    card.append(title, text, progress, buttons);
    card.addEventListener('animationend', () => card.classList.remove('is-flashing'));

    news.addEventListener('click', () => {
      const url = `${RELEASES}/tag/v${update.version}`;
      if (isTauri) openUrl(url).catch((e) => notice(errorMessage(e)));
    });
    later.addEventListener('click', () => {
      this.postponed = update.version;
      this.close();
    });
    install.addEventListener('click', () => void this.install(update, { card, text, bar, buttons }));

    document.body.append(card);
    this.card = card;
  }

  private async install(
    update: Pending,
    ui: { card: HTMLElement; text: HTMLElement; bar: HTMLElement; buttons: HTMLElement },
  ): Promise<void> {
    if (!(await this.host.prepareForUpdate())) return;
    ui.card.classList.add('is-installing');
    ui.buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await update.install((phase, fraction) => {
        ui.bar.classList.toggle('is-indeterminate', fraction === null);
        ui.bar.style.width = fraction === null ? '' : `${Math.round(fraction * 100)}%`;
        ui.text.textContent =
          phase === 'install'
            ? 'Installation…'
            : `Téléchargement…${fraction === null ? '' : ` ${Math.round(fraction * 100)} %`}`;
      });
      ui.text.textContent = 'Redémarrage…';
      if (isTauri) await relaunch();
    } catch (e) {
      ui.card.classList.remove('is-installing');
      ui.bar.classList.remove('is-indeterminate');
      ui.bar.style.width = '';
      ui.text.textContent = `La mise à jour a échoué : ${errorMessage(e)}`;
      ui.buttons.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  private close(): void {
    this.card?.remove();
    this.card = null;
  }
}
