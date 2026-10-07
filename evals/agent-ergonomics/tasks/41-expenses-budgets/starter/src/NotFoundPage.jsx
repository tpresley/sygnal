import { href } from './routes.js'

function NotFoundPage() {
  return (
    <section className="not-found">
      <h1>Page not found</h1>
      <a href={href('dashboard')}>Back to the dashboard</a>
    </section>
  )
}

export default NotFoundPage
