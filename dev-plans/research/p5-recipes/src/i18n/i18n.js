// i18n.js
import i18next from 'i18next'

export const LOCALES = { en: 'English', fr: 'Français' }

export const i18n = i18next.createInstance()
i18n.init({
  initAsync: false, // the resources are here: ready before the first render
  interpolation: { escapeValue: false }, // Sygnal renders strings as text, never as HTML
  fallbackLng: 'en',
  supportedLngs: Object.keys(LOCALES),
  resources: {
    en: {
      translation: {
        language: 'Language',
        greeting: 'Hello, {{name}}!',
        cart: {
          title: 'Your cart',
          add: 'Add a coffee',
          items_one: '{{count}} item',
          items_other: '{{count}} items',
          total: 'Total: {{total, currency(EUR)}}',
        },
      },
    },
    fr: {
      translation: {
        language: 'Langue',
        greeting: 'Bonjour, {{name}} !',
        cart: {
          title: 'Votre panier',
          add: 'Ajouter un café',
          items_one: '{{count}} article',
          items_other: '{{count}} articles',
          total: 'Total : {{total, currency(EUR)}}',
        },
      },
    },
  },
})

// One t() per locale, made once: the context value changes only when the locale does
const fixed = {}
export const translator = (locale) => (fixed[locale] ||= i18n.getFixedT(locale))

// The browser's language; 'en' on the server (Node 21+ has a navigator too, with the server's)
export function detectLocale() {
  const lang = typeof window === 'undefined' ? 'en' : (navigator.language || '').slice(0, 2)
  return lang in LOCALES ? lang : 'en'
}
