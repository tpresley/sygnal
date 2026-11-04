import { href } from '../routes.js'

function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p><a href={href('list')}>All filters</a></p>
    </section>
  )
}

export default NotFound
