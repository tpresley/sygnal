// The app's own data: the destinations a trip can go to. The model sees them through the agent's
// `read` (Trips.jsx), so the places and prices it quotes are these, never invented ones.
export const DESTINATIONS = [
  {
    id: 'lisbon', name: 'Lisbon', country: 'Portugal', emoji: '🚋', price: 140, vibes: ['warm', 'city', 'food'],
    blurb: 'Hilly streets, tiled facades and custard tarts; 24°C and sunny into October.',
    highlights: ['Tram 28 through Alfama', 'Sunset at Miradouro da Graça', 'A day trip to Sintra'],
  },
  {
    id: 'marrakech', name: 'Marrakech', country: 'Morocco', emoji: '🕌', price: 95, vibes: ['warm', 'city', 'culture'],
    blurb: 'Souks, riads and rooftop dinners; warm and dry most of the year.',
    highlights: ['The Jemaa el-Fnaa night market', 'Jardin Majorelle', 'A hammam afternoon'],
  },
  {
    id: 'bali', name: 'Ubud, Bali', country: 'Indonesia', emoji: '🌴', price: 80, vibes: ['warm', 'nature', 'wellness'],
    blurb: 'Rice terraces, jungle villas and yoga at sunrise; tropical all year.',
    highlights: ['Tegallalang rice terraces', 'The Sacred Monkey Forest', 'Sunrise on Mount Batur'],
  },
  {
    id: 'kyoto', name: 'Kyoto', country: 'Japan', emoji: '⛩️', price: 160, vibes: ['city', 'culture', 'food'],
    blurb: 'Temples, gardens and quiet lanes; mild in autumn, with the maples turning red.',
    highlights: ['Fushimi Inari at dawn', 'The Arashiyama bamboo grove', 'A kaiseki dinner in Gion'],
  },
  {
    id: 'reykjavik', name: 'Reykjavík', country: 'Iceland', emoji: '🌋', price: 210, vibes: ['nature', 'adventure'],
    blurb: 'Glaciers, geysers and the northern lights; cold, dramatic and unforgettable.',
    highlights: ['The Golden Circle', 'The Blue Lagoon', 'A northern-lights hunt'],
  },
]

export const destinationOf = (id) => DESTINATIONS.find((d) => d.id === id)

/** the trip before any answer */
export const NEW_TRIP = { destination: null, nights: null, travelers: null, booked: false }
