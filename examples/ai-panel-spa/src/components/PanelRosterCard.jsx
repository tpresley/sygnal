function tooltipText(member) {
  const guidelines = Array.isArray(member.styleGuidelines) ? member.styleGuidelines.join(' | ') : 'N/A'
  return `EXPERTISE: ${member.expertise}\n\n GOAL: ${member.goal}\n\n STYLE: ${guidelines}`
}

function PanelRosterCard({ panel }) {
  if (!panel) {
    return (
      <article className="card panel-card">
        <h2>Panel Roster</h2>
        <p>No panel generated yet.</p>
      </article>
    )
  }

  const members = [
    { ...panel.moderator, isModerator: true },
    ...panel.experts.map((expert) => ({ ...expert, isModerator: false }))
  ]

  return (
    <article className="card panel-card">
      <h2>Panel Roster</h2>
      <div className="chip-list">
        {members.map((member) => (
          <div
            key={member.id}
            className={member.isModerator ? 'panel-chip moderator' : 'panel-chip'}
            data-tooltip={tooltipText(member)}
          >
            <span className="chip-name">{member.name}</span>
            <span className="chip-role">{member.role}</span>
          </div>
        ))}
      </div>
    </article>
  )
}

export default PanelRosterCard
