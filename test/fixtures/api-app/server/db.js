import fs from 'node:fs'
export const DB_PASSWORD = 'db-password-server-only-1234'
export const rows = () => (fs.existsSync('/nonexistent') ? [] : [{ id: 1, text: 'SERVER_ROW_MARKER' }])
