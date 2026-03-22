function Page({ state }) {
  return (
    <div className="page">
      <h1>About</h1>
      <p>{state.description}</p>
    </div>
  )
}

Page.initialState = {
  description: 'Built with Sygnal and Vike. Edit this page at pages/about/+Page.jsx.',
}

export default Page
