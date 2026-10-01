export default function BookRow({ book, onFinishedChange, onRemove }) {
  return (
    <li className={book.finished ? 'book finished' : 'book'}>
      <label>
        <input
          type="checkbox"
          className="finished-toggle"
          checked={book.finished}
          onChange={(e) => onFinishedChange(e.target.checked)}
        />
        Finished
      </label>
      <span className="title">{book.title}</span>
      <button className="remove" onClick={onRemove}>
        Remove
      </button>
    </li>
  )
}
