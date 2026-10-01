export default function ProfilePage({ name, onNameChange, myCourses }) {
  return (
    <section className="profile">
      <h2>Your profile</h2>
      <label>
        Name <input name="name" className="name-input" value={name} onChange={(e) => onNameChange(e.target.value)} />
      </label>
      <h3>My courses</h3>
      {myCourses.length === 0 ? (
        <p className="no-courses">No courses yet.</p>
      ) : (
        <ul className="my-courses">
          {myCourses.map((course) => (
            <li key={course.id}>{course.title}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
