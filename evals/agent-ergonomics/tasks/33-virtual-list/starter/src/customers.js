const CITIES = ['Lisbon', 'Oslo', 'Prague', 'Quito', 'Seoul', 'Tunis', 'Vienna']

/** 10,000 customers: { id, name, city, starred }, ids 1 to 10,000. */
export const CUSTOMERS = Array.from({ length: 10000 }, (_, i) => ({
  id: i + 1,
  name: `Customer ${i + 1}`,
  city: CITIES[i % CITIES.length],
  starred: false,
}))
