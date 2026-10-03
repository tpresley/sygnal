import { useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { useTasks, useTitle } from './tasks.js'
import NotFound from './NotFound.jsx'

function EditForm({ task, saveTitle }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(task.title)
  // set by Save, so its own navigation isn't blocked (the state update lands after navigate())
  const saving = useRef(false)
  const changed = draft !== task.title
  const blocker = { state: 'unblocked' } // mutant: no navigation guard
  void changed
  useTitle(`Edit ${task.title} · Tasks`)

  const save = () => {
    saving.current = true
    saveTitle(task.id, draft)
    navigate(`/tasks/${task.id}`)
  }

  return (
    <section className="edit-page">
      <h1>Edit task</h1>
      <input name="title" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button className="save" onClick={save}>
        Save
      </button>
      <Link to={`/tasks/${task.id}`}>Cancel</Link>
      {blocker.state === 'blocked' && (
        <div className="confirm">
          <p>Discard your changes?</p>
          <button className="leave" onClick={() => blocker.proceed()}>
            Leave
          </button>
          <button className="stay" onClick={() => blocker.reset()}>
            Stay
          </button>
        </div>
      )}
    </section>
  )
}

export default function EditPage() {
  const { id } = useParams()
  const { tasks, saveTitle } = useTasks()
  const task = tasks.find((t) => String(t.id) === id)
  return task ? <EditForm key={task.id} task={task} saveTitle={saveTitle} /> : <NotFound />
}
