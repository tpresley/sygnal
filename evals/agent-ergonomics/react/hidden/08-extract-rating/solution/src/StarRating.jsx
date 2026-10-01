const STARS = [1, 2, 3, 4, 5]

export default function StarRating({ name, label, value, onChange }) {
  return (
    <div className={`rating ${name}`}>
      <span className="label">{label}</span>
      {STARS.map((n) => (
        <button key={n} className={n <= value ? 'star filled' : 'star'} onClick={() => onChange(n)}>
          ★
        </button>
      ))}
    </div>
  )
}
