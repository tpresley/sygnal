// SYG507 (info): a prop passed on unchanged through 3 component levels.
function App({ state }) {
  return (
    <div className="app">
      <Toolbar theme={state.theme} user={state.user} />
    </div>
  )
}

function Toolbar({ theme, user, ...props }) {
  return (
    <nav>
      <Menu theme={theme} /> {/* expect: SYG507 info */}
      <Avatar user={props.user} name={user.name} />
    </nav>
  )
}

function Menu(props) {
  return <ul className={props.theme}><Item theme={props.theme} /></ul> // expect: SYG507 info
}

function Item({ theme }) {
  return <li className={theme}>item</li>
}

function Avatar({ name }) {
  return <img alt={name} />
}

App.initialState = { theme: 'dark', user: { name: 'a' } }

export default App
