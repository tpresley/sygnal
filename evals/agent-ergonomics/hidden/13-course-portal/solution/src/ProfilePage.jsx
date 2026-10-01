function ProfilePage({ state }) {
  const mine = state.courses.filter((course) => course.enrolled)
  return (
    <section className="profile">
      <h2>Your profile</h2>
      <label>
        Name <input name="name" className="name-input" value={state.name} />
      </label>
      <h3>My courses</h3>
      {mine.length === 0 ? (
        <p className="no-courses">No courses yet.</p>
      ) : (
        <ul className="my-courses">
          {mine.map((course) => (
            <li>{course.title}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

ProfilePage.intent = ({ DOM }) => ({
  SET_NAME: DOM.input('.name-input').value(),
})

ProfilePage.model = {
  SET_NAME: (state, name) => ({ ...state, name }),
}

export default ProfilePage
