/**
 * A nested Layout: Vike's Layout is cumulative, so pages under /admin get the root Layout
 * (pages/+Layout.jsx) around this one. Nesting: Wrapper > root Layout > admin Layout > Page.
 */

function AdminLayout({ state, children, innerHTML }) {
  return (
    <section className="admin-layout">
      <aside className="admin-sidebar">
        <strong>Admin</strong>
        {!state.collapsed && <span className="admin-note">Nested Layout</span>}
        <button className="admin-collapse" type="button">
          {state.collapsed ? 'Expand' : 'Collapse'}
        </button>
      </aside>
      {children && children.length
        ? <div className="admin-content">{children}</div>
        : <div className="admin-content" props={{ innerHTML: innerHTML || '' }}></div>
      }
    </section>
  )
}

AdminLayout.initialState = {
  collapsed: false,
}

AdminLayout.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.admin-collapse').events('click'),
})

AdminLayout.model = {
  TOGGLE: (state) => ({ ...state, collapsed: !state.collapsed }),
}

export default AdminLayout
