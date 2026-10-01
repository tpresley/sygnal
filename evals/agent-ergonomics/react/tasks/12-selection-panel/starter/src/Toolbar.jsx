export default function Toolbar({ hideDone, onHideDoneChange }) {
  return (
    <div className="toolbar">
      <label>
        <input
          type="checkbox"
          className="hide-done"
          checked={hideDone}
          onChange={(e) => onHideDoneChange(e.target.checked)}
        />
        Hide done
      </label>
    </div>
  )
}
