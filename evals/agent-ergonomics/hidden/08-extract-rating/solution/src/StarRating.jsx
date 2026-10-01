const STARS = [1, 2, 3, 4, 5]

// Props: name (row id, also used as a class), label, value (current rating).
// Reports the picked value to the parent as { name, value }.
function StarRating({ name, label, value }) {
  return (
    <div className={`rating ${name}`}>
      <span className="label">{label}</span>
      {STARS.map((n) => (
        <button className={n <= value ? 'star filled' : 'star'} data-value={String(n)}>
          ★
        </button>
      ))}
    </div>
  )
}

StarRating.intent = ({ DOM }) => ({
  PICK: DOM.click('.star').data('value', Number),
})

StarRating.model = {
  PICK: {
    PARENT: (state, value, next, props) => ({ name: props.name, value }),
  },
}

export default StarRating
