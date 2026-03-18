function UserCard({ state } = {}) {
  return (
    <div className="user-card">
      <h2>{state.name}</h2>
      <p>Age: {state.age}</p>
      <button type="button" className="birthday">Have Birthday</button>
    </div>
  )
}

UserCard.intent = ({ DOM }) => ({
  BIRTHDAY: DOM.select('.birthday').events('click')
})

UserCard.model = {
  BIRTHDAY: (state) => ({ ...state, age: state.age + 1 })
}

export default UserCard
