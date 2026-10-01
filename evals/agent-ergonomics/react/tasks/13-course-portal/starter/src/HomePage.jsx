export default function HomePage({ name }) {
  return (
    <section className="home">
      <h2>Welcome back, {name}!</h2>
      <p className="intro">Pick up where you left off, or browse something new.</p>
    </section>
  )
}
