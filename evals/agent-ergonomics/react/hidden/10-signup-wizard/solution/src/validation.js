export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
export const isValidPassword = (password) => password.length >= 8

export const PLAN_LABELS = { free: 'Free', pro: 'Pro', team: 'Team' }
