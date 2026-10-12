// The app's own data: the plans the assistant helps with. The model sees them through the agent
// declaration's `read` (Assistant.jsx), so the prices it quotes are these, not invented ones.
export const PLANS = [
  { id: 'free', name: 'Free', price: 0, seats: 1, features: ['1 project', 'Community support'] },
  { id: 'team', name: 'Team', price: 12, seats: 10, features: ['Unlimited projects', 'Shared workspaces', 'Email support'] },
  { id: 'business', name: 'Business', price: 30, seats: 100, features: ['Everything in Team', 'SSO and audit log', 'A support contact who answers in 4 hours'] },
]

/** "$12 per seat a month" */
export const priceOf = (plan) => (plan.price === 0 ? 'free' : `$${plan.price} per seat a month`)

/** prompts to start with */
export const EXAMPLES = [
  'Which plan should I take?',
  'Switch me to the plan that fits a team of 5',
  'I want to talk to sales about Business',
  'How do you rate the help so far? Ask me.',
]
