// a route parameter: '/orders/@id'
export default function Order({ context }) {
  return <p>order {context.routeParams.id}</p>
}
