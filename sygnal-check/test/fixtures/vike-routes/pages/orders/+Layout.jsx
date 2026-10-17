// a nested Layout: the pages under orders/
export default function OrdersLayout({ state, children }) {
  return <section><nav>{state.count} orders</nav>{children}</section>
}
OrdersLayout.initialState = { count: 0 }
