import UserCard from './UserCard.jsx'

function UserCardDemo({ state }) {
  return (
    <div>
      <p className="state-debug">
        Full app state: {JSON.stringify(state)}
      </p>
      <UserCard state="user" />
    </div>
  )
}

UserCardDemo.initialState = {
  user: { name: 'Alice', age: 30 },
  settings: { theme: 'dark' }
}

export default UserCardDemo
