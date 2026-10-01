// The reading list is kept in localStorage so it survives a reload.
const KEY = 'reading-list'

export const SEED_BOOKS = [
  { id: 1, title: 'Middlemarch', finished: false },
  { id: 2, title: 'Beloved', finished: true },
  { id: 3, title: 'The Remains of the Day', finished: false },
  { id: 4, title: 'Kindred', finished: false },
]

export function loadBooks() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(saved) ? saved : SEED_BOOKS
  } catch {
    return SEED_BOOKS
  }
}

export function saveBooks(books) {
  localStorage.setItem(KEY, JSON.stringify(books))
}
