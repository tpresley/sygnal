import { createContext, useContext, useEffect } from 'react'

export const TasksContext = createContext(null)

/** { tasks, saveTitle(id, title) } */
export const useTasks = () => useContext(TasksContext)

/** Sets the document title while the calling page is shown. */
export function useTitle(title) {
  useEffect(() => {
    document.title = title
  }, [title])
}
