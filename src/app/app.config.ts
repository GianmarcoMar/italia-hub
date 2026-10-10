import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withJsonpSupport } from '@angular/common/http';
import localeIt from '@angular/common/locales/it';

// date e numeri in italiano in tutte le pipe (es. "8 ott", "3,1")
registerLocaleData(localeIt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withJsonpSupport()),
    { provide: LOCALE_ID, useValue: 'it' },
  ],
};
