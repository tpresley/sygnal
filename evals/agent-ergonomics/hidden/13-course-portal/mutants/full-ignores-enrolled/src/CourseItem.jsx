import { ABORT } from 'sygnal'

function CourseItem({ state }) {
  const full = state.seats === 0 // MUTANT: an enrolled user who took the last seat sees "Full"
  return (
    <li className="course">
      <span className="course-title">{state.title}</span>
      <span className="seats">{`${state.seats} seats left`}</span>
      <button className="enroll" disabled={full}>
        {state.enrolled ? 'Leave' : full ? 'Full' : 'Enroll'}
      </button>
    </li>
  )
}

CourseItem.intent = ({ DOM }) => ({
  TOGGLE_ENROLL: DOM.click('.enroll'),
})

CourseItem.model = {
  TOGGLE_ENROLL: (state) => {
    if (state.enrolled) return { ...state, enrolled: false, seats: state.seats + 1 }
    if (state.seats === 0) return ABORT
    return { ...state, enrolled: true, seats: state.seats - 1 }
  },
}

export default CourseItem
