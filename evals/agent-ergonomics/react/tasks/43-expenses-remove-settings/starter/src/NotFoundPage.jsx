import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <section className="not-found">
      <h1>Page not found</h1>
      <Link to="/">Back to the dashboard</Link>
    </section>
  )
}
