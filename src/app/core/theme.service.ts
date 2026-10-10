import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const KEY = 'italia-hub:theme';

/** Tema della console: scuro di default, chiaro a scelta (attributo data-theme su <html>). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.load());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.dataset['theme'] = t;
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* storage non disponibile */
      }
    });
  }

  toggle() {
    this.theme.update(t => (t === 'dark' ? 'light' : 'dark'));
  }

  private load(): Theme {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
