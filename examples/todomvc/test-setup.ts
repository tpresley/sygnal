// Vitest setup: Sygnal's runtime dev checks (renderComponent collects their
// diagnostics). Imported from a local file rather than listed directly in
// test.setupFiles: under the jsdom environment Vitest can't load a setup file
// that lives outside the project (the linked sygnal package), so the sygnal()
// plugin's automatic setup file is turned off in vite.config.ts.
import 'sygnal/diagnostics'
