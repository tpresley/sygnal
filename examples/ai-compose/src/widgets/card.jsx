// The card every part sits in: a view helper (a plain function, not a component), so a part is
// one instance and its title is the app's own wording.
export const card = (part, title, body) => (
  <section className={`card part-${part}`}>
    <h3>{title}</h3>
    {body}
  </section>
)
