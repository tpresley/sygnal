// App.jsx
import { persist } from 'sygnal'
import { LOCALES, translator, detectLocale } from './i18n.js'
import { Cart } from './Cart.jsx'

export function App({ state }) {
  const t = translator(state.locale)
  return (
    <main lang={state.locale}>
      <label>
        {t('language')}
        <select className="locale" value={state.locale}>
          {Object.entries(LOCALES).map(([code, name]) => <option value={code}>{name}</option>)}
        </select>
      </label>
      <h1>{t('greeting', { name: state.name })}</h1>
      <Cart state="cart" />
    </main>
  )
}

App.initialState = { locale: detectLocale(), name: 'Ada', cart: { items: 0 } }

App.context = { t: (state) => translator(state.locale) }

App.intent = ({ DOM }) => ({
  LOCALE: DOM.change('.locale').value(),
})

App.model = {
  LOCALE: (state, locale) => ({ ...state, locale }),
}

App.persist = persist({ key: 'locale', pick: ['locale'] })
