import type { RootComponent } from 'sygnal'

type State = {
  description: string
}

type Page = RootComponent<State>

const Page: Page = function ({ state }) {
  return (
    <div className="page">
      <h1>About</h1>
      <p>{state.description}</p>
    </div>
  )
}

Page.initialState = {
  description: 'Built with Sygnal and Vike. Edit this page at pages/about/+Page.tsx.',
}

export default Page
