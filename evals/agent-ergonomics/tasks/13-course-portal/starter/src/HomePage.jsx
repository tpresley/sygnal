function HomePage({ state }) {
  return (
    <section className="home">
      <h2>Welcome back, {state.name}!</h2>
      <p className="intro">Pick up where you left off, or browse something new.</p>
    </section>
  )
}

export default HomePage
