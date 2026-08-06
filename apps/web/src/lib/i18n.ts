import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import commonEn from '@/locales/en/common.json'
import commonAr from '@/locales/ar/common.json'
import heroEn from '@/locales/en/hero.json'
import heroAr from '@/locales/ar/hero.json'
import problemEn from '@/locales/en/problem.json'
import problemAr from '@/locales/ar/problem.json'
import howItWorksEn from '@/locales/en/howItWorks.json'
import howItWorksAr from '@/locales/ar/howItWorks.json'
import featuresEn from '@/locales/en/features.json'
import featuresAr from '@/locales/ar/features.json'
import whoItsForEn from '@/locales/en/whoItsFor.json'
import whoItsForAr from '@/locales/ar/whoItsFor.json'
import comparisonEn from '@/locales/en/comparison.json'
import comparisonAr from '@/locales/ar/comparison.json'
import faqEn from '@/locales/en/faq.json'
import faqAr from '@/locales/ar/faq.json'
import quoteFormEn from '@/locales/en/quoteForm.json'
import quoteFormAr from '@/locales/ar/quoteForm.json'
import loginEn from '@/locales/en/login.json'
import loginAr from '@/locales/ar/login.json'
import appEn from '@/locales/en/app.json'
import appAr from '@/locales/ar/app.json'
import adminEn from '@/locales/en/admin.json'
import adminAr from '@/locales/ar/admin.json'

export const supportedLanguages = ['en', 'ar'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

const rtlLanguages: readonly SupportedLanguage[] = ['ar']

export function isRtlLanguage(language: string): boolean {
  return rtlLanguages.includes(language as SupportedLanguage)
}

function applyDocumentDirection(language: string): void {
  document.documentElement.lang = language
  document.documentElement.dir = isRtlLanguage(language) ? 'rtl' : 'ltr'
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        hero: heroEn,
        problem: problemEn,
        howItWorks: howItWorksEn,
        features: featuresEn,
        whoItsFor: whoItsForEn,
        comparison: comparisonEn,
        faq: faqEn,
        quoteForm: quoteFormEn,
        login: loginEn,
        app: appEn,
        admin: adminEn,
      },
      ar: {
        common: commonAr,
        hero: heroAr,
        problem: problemAr,
        howItWorks: howItWorksAr,
        features: featuresAr,
        whoItsFor: whoItsForAr,
        comparison: comparisonAr,
        faq: faqAr,
        quoteForm: quoteFormAr,
        login: loginAr,
        app: appAr,
        admin: adminAr,
      },
    },
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    ns: [
      'common',
      'hero',
      'problem',
      'howItWorks',
      'features',
      'whoItsFor',
      'comparison',
      'faq',
      'quoteForm',
      'login',
      'app',
      'admin',
    ],
    defaultNS: 'common',
    detection: {
      // No browser-language auto-detect: first-time visitors default to
      // English. Only an explicit prior choice (saved below) changes that.
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'aluminia-language',
    },
    interpolation: { escapeValue: false },
  })

// Runs synchronously at import time, before the app renders, so the page
// never paints in the wrong direction and then flips.
applyDocumentDirection(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyDocumentDirection)

export default i18n
