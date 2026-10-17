import { Collection, Switchable, ABORT } from 'sygnal'
import { Toaster } from 'sygnal/ui'
import Header from './Header.jsx'
import ProductCard from './ProductCard.jsx'
import Cart from './Cart.jsx'
import Checkout from './Checkout.jsx'

export default function App({ state }) {
  return (
    <div className="app">
      <Header />
      <Greeting state="user" />
      <Toaster />
      <Switchable of={{ shop: Shop, cart: Cart, checkout: Checkout }} current={state.page} />
    </div>
  )
}

// PLAN-10 A-1: view-only components (no statics)
function Greeting({ state }) {
  return <p className="greeting">Hello {state?.name ?? 'guest'}</p>
}

function Shop({ state }) {
  return <div className="shop"><Collection of={ProductCard} from="products" /></div>
}

App.initialState = { page: 'shop', products: [], cart: [], user: null }
App.context = {
  currency: state => state.user?.currency ?? 'USD',
  cartCount: state => state.cart.length,
}
App.intent = ({ DOM, EVENTS }) => ({
  GO: EVENTS.select('NAVIGATE'),
  ADD_TO_CART: EVENTS.select('ADD_TO_CART'),
  REMOVE: EVENTS.select('REMOVE_ITEM'),
})
App.model = {
  GO: (state, page) => ({ ...state, page }),
  ADD_TO_CART: (state, item) => ({ ...state, cart: [...state.cart, item] }),
  REMOVE: (state, id) => ({ ...state, cart: state.cart.filter(i => i.id !== id) }),
  SAVE_CART: { EFFECT: () => {} },
  BOOTSTRAP: { HTTP: () => ({ url: '/api/products', category: 'products' }) },
  PRODUCTS: (state, products) => ({ ...state, products }),
}
App.connections = { PRODUCTS: { HTTP: 'products' } }
