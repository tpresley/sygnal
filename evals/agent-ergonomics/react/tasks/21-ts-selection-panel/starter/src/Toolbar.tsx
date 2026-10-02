type ToolbarProps = {
  hideDone: boolean
  onHideDoneChange: (hideDone: boolean) => void
}

export default function Toolbar({ hideDone, onHideDoneChange }: ToolbarProps) {
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
