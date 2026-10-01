export default function ProfilePage({ name, onNameChange }) {
  return (
    <section className="profile">
      <h2>Your profile</h2>
      <label>
        Name <input name="name" className="name-input" value={name} onChange={(e) => onNameChange(e.target.value)} />
      </label>
    </section>
  )
}
