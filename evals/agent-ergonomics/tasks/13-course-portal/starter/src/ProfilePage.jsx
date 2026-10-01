function ProfilePage({ state }) {
  return (
    <section className="profile">
      <h2>Your profile</h2>
      <label>
        Name <input name="name" className="name-input" value={state.name} />
      </label>
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
