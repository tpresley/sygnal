import { useState } from 'react'
import Toolbar from './Toolbar.jsx'
import ProjectSection from './ProjectSection.jsx'
import DetailsPanel from './DetailsPanel.jsx'

const initialProjects = [
  {
    id: 'web',
    name: 'Website',
    tasks: [
      { id: 1, title: 'Fix login bug', assignee: 'Priya', done: false },
      { id: 2, title: 'Update footer links', assignee: 'Sam', done: true },
      { id: 3, title: 'Write release notes', assignee: 'Lee', done: false },
    ],
  },
  {
    id: 'app',
    name: 'Mobile app',
    tasks: [
      { id: 4, title: 'Crash on startup', assignee: 'Sam', done: false },
      { id: 5, title: 'Dark mode', assignee: 'Priya', done: false },
    ],
  },
]

export default function App() {
  const [projects, setProjects] = useState(initialProjects)
  const [hideDone, setHideDone] = useState(false)

  const openCount = projects.reduce((sum, project) => sum + project.tasks.filter((task) => !task.done).length, 0)

  const updateTasks = (projectId, update) =>
    setProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, tasks: update(project.tasks) } : project))
    )

  const toggleTask = (projectId, taskId) =>
    updateTasks(projectId, (tasks) => tasks.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task)))

  const deleteTask = (projectId, taskId) => updateTasks(projectId, (tasks) => tasks.filter((task) => task.id !== taskId))

  return (
    <div className="tracker">
      <header className="tracker-header">
        <h1>Team tasks</h1>
        <p className="summary">{openCount} open</p>
      </header>
      <Toolbar hideDone={hideDone} onHideDoneChange={setHideDone} />
      <div className="layout">
        <main className="projects">
          <div className="project-list">
            {projects.map((project) => (
              <ProjectSection
                key={project.id}
                project={project}
                hideDone={hideDone}
                onToggle={(taskId) => toggleTask(project.id, taskId)}
                onDelete={(taskId) => deleteTask(project.id, taskId)}
              />
            ))}
          </div>
        </main>
        <DetailsPanel />
      </div>
    </div>
  )
}
