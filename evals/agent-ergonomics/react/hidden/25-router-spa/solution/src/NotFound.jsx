import { useTitle } from './tasks.js'

export default function NotFound() {
  useTitle('Not found · Tasks')
  return (
    <section className="not-found">
      <h1>Not found</h1>
    </section>
  )
}
