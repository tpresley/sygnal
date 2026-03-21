function Page({ state }) {
  return (
    <div className="page">
      <nav>
        <a href="/">Home</a> | <a href="/about">About</a>
      </nav>
      <h1>About</h1>
      <p>{state.description}</p>
      <p>
        This page was rendered {state.renderedAt ? 'with data from +data()' : 'without data'}.
      </p>
    </div>
  )
}

Page.initialState = {
  description: '',
  renderedAt: '',
}

export default Page
