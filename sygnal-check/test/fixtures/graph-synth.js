/**
 * Seeded synthetic InspectGraphs for the large-app tests (PLAN-10 V-4): S-1's generator
 * (dev-plans/research/graph-viz/large/gen.mjs, Node built-ins only), so the tests and the S-1
 * measurements use the same shapes.
 *
 *   synthGraph(n, seed = 1) → an InspectGraph with exactly n components: App → Shell → Header /
 *   Router (a Switchable of feature pages) / Footer, features under src/features/<f>/, shared
 *   components, extra entries above 200 / 500, NAVIGATE from 2.5 % of components, context
 *   providers, duplicate names, diagnostics, agent surfaces and behavior actions
 */
export { generate as synthGraph } from '../../../dev-plans/research/graph-viz/large/gen.mjs'
