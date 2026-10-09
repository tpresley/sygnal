import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import pkg from './package.json' with { type: "json" };

// Runtime dependencies stay external in the npm (CJS/ESM) builds (D209): snabbdom, xstream and
// @tanstack/virtual-core. Only the standalone UMD build bundles them.
const isExternal = (id) => /^(snabbdom|xstream|@tanstack\/virtual-core)(\/|$)/.test(id);

// Outside a bundler (plain Node `require()` of the CJS build, or native Node ESM `import`
// of the ESM build), `import xs from 'xstream'` gets xstream's whole `module.exports`
// object, whose `.default` is the real `xs`, so `xs.create()` etc. threw and `run()` could
// not start (G-067). Bundlers apply `__esModule` interop and were unaffected. This plugin
// routes every `'xstream'` import of an entry that keeps xstream external through one
// shim that picks the right default in all three environments.
const XSTREAM_SHIM = '\0sygnal:xstream'
const xstreamInterop = () => ({
	name: 'sygnal-xstream-interop',
	resolveId(source, importer) {
		if (source === 'xstream' && importer !== XSTREAM_SHIM) return XSTREAM_SHIM
		return null
	},
	load(id) {
		if (id !== XSTREAM_SHIM) return null
		return [
			"import * as ns from 'xstream';",
			'const d = ns.default;',
			"const xs = d && typeof d.create === 'function' ? d : d && d.default && typeof d.default.create === 'function' ? d.default : ns;",
			'export default xs;',
			"export { Stream, MemoryStream, NO, NO_IL } from 'xstream';",
		].join('\n')
	},
})

// `external` is consulted before resolveId, so the bare 'xstream' import must not be
// external for src modules (it resolves to the shim); only the shim's own import is.
const shimXstream = (external) => (id, importer, isResolved) =>
	id === 'xstream' && importer !== XSTREAM_SHIM ? false : external(id, importer, isResolved)

// P46-Q (D188): the JSX runtime entries ('sygnal/jsx', 'sygnal/jsx-runtime',
// 'sygnal/jsx-dev-runtime') use the core's pragma: their './pragma/index' import becomes the
// external 'sygnal' (the core entry exports createElement), so an app ships the pragma once.
// snabbdom stays external too (their Fragment is snabbdom's, tagged in ./cycle/dom/fragment)
const jsxExternal = (id) => isExternal(id) || id === 'sygnal'
const jsxCorePragma = () => ({
	name: 'sygnal-jsx-core-pragma',
	resolveId(source, importer) {
		if (source === './pragma/index' && importer && /[\\/]src[\\/]jsx(-runtime|-dev-runtime)?\.ts$/.test(importer)) {
			return { id: 'sygnal', external: true }
		}
		return null
	},
})

// PLAN-5 V-1: @tanstack/virtual-core (VirtualCollection) is a regular dependency (D209), external
// in the npm builds. The standalone UMD build bundles it like snabbdom and xstream; its dist reads
// `process.env.NODE_ENV` for debug-only memo keys, which would throw in a browser without a
// bundler: it becomes "production" there
const virtualCoreEnv = () => ({
	name: 'sygnal-virtual-core-env',
	transform(code, id) {
		if (!/[\\/]@tanstack[\\/]virtual-core[\\/]/.test(id) || !code.includes('process.env.NODE_ENV')) return null
		return { code: code.replace(/process\.env\.NODE_ENV/g, '"production"'), map: null }
	},
})

const sourcemapOptions = {
	sourcemap: true,
	sourcemapExcludeSources: false,
};

export default [
	// browser-friendly UMD build
	{
		input: 'src/index.ts',
		output: {
			name: 'Sygnal',
			file: "./dist/sygnal.min.js",
			format: 'umd',
			...sourcemapOptions,
		},
		plugins: [
			virtualCoreEnv(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs(),
      terser({ maxWorkers: 1, sourceMap: true })
		]
	},

	{
		input: 'src/index.ts',
		external: shimXstream(isExternal),
		output: [
			{ file: pkg.main, format: 'cjs', ...sourcemapOptions },
			{ file: pkg.module, format: 'es', ...sourcemapOptions }
		],
		plugins: [
			xstreamInterop(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
	},

  {
    input: 'src/jsx.ts',
    external: jsxExternal,
    output: [
      { file: pkg.exports['./jsx'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			jsxCorePragma(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/jsx-runtime.ts',
    external: jsxExternal,
    output: [
      { file: pkg.exports['./jsx-runtime'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx-runtime'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			jsxCorePragma(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/jsx-dev-runtime.ts',
    external: jsxExternal,
    output: [
      { file: pkg.exports['./jsx-dev-runtime'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx-dev-runtime'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			jsxCorePragma(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  // 'sygnal/diagnostics': dev-only runtime checks (PLAN-1 1A). The checks must
  // share the diagnostics core instance of the 'sygnal' package, so the core
  // import (src/extra/diagnostics/index.ts) becomes the external 'sygnal'.
  {
    input: 'src/extra/diagnostics/checks/index.ts',
    external: shimXstream((id) => isExternal(id) || id === 'sygnal'),
    output: [
      { file: pkg.exports['./diagnostics'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./diagnostics'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			xstreamInterop(),
			{
				name: 'sygnal-diagnostics-core-external',
				resolveId(source, importer) {
					if (source === '../index' && importer && /[\\/]extra[\\/]diagnostics[\\/]checks[\\/]/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  // 'sygnal/devtools' (D77): the DevTools bridge, dev only (sygnal/vite injects it in
  // dev). Its diagnostics import becomes the external 'sygnal' so it reads the app's
  // diagnostics core, as 'sygnal/diagnostics' does.
  {
    input: 'src/devtools.ts',
    external: (id) => isExternal(id) || id === 'sygnal',
    output: [
      { file: pkg.exports['./devtools'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./devtools'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-devtools-core-external',
				resolveId(source, importer) {
					if (source === './diagnostics/index' && importer && /[\\/]extra[\\/]devtools\.ts$/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // 'sygnal/element' (PLAN-4 GS-13, D127): defineElement. Its './index' import becomes the
  // external 'sygnal', so the entry adds 0 B to the core bundle. ES2022: native #private
  // fields and a static block (custom elements need a modern browser anyway).
  {
    input: 'src/element.ts',
    external: (id) => isExternal(id) || id === 'sygnal',
    output: [
      { file: pkg.exports['./element'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./element'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-element-core-external',
				resolveId(source, importer) {
					if (source === './index' && importer && /[\\/]src[\\/]element\.ts$/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json', compilerOptions: { target: 'ES2022' } }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // 'sygnal/ui' (PLAN-5 U-1, D202): the headless UI parts. Every part's '../index' import
  // becomes the external 'sygnal' (0 B in the core bundle, one core per app); each part
  // tree-shakes on its own (module-level defineBehavior calls are /*#__PURE__*/).
  {
    input: 'src/ui.ts',
    external: (id) => isExternal(id) || id === 'sygnal',
    output: [
      { file: pkg.exports['./ui'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./ui'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-ui-core-external',
				resolveId(source, importer) {
					if (source === '../index' && importer && /[\\/]src[\\/]ui[\\/]/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // 'sygnal/ai' (PLAN-6, D240/D253): the implementation is in the main bundle (src/extra/ai/); this
  // entry re-exports it from the external 'sygnal', so it never carries a second copy of the reply
  // helpers or the diagnostics module (G-581: a copy silenced the app's dev checks).
  {
    input: 'src/ai.ts',
    external: (id) => isExternal(id) || id === 'sygnal',
    output: [
      { file: pkg.exports['./ai'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./ai'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-ai-core-external',
				resolveId(source, importer) {
					if (source === './index' && importer && /[\\/]src[\\/]ai\.ts$/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // PLAN-5 W-2 (D203, D209): the adapter entries. Their framework / Zag imports stay external
  // (optional peerDependencies: an app that doesn't import the entry never needs them), and their
  // core import becomes the external 'sygnal' (0 B in the core bundle, one core per app).
  // 'sygnal/zag': fromZag (@zag-js/vanilla, a private snabbdom patch).
  // 'sygnal/ui/menu', 'sygnal/ui/select', 'sygnal/ui/combobox': the parts on fromZag ('../../zag'
  // → the external 'sygnal/zag', so an app using several ships fromZag once). 'sygnal/react': fromReact (react, react-dom).
  {
    input: 'src/zag.ts',
    external: (id) => isExternal(id) || id === 'sygnal' || /^@zag-js\//.test(id),
    output: [
      { file: pkg.exports['./zag'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./zag'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-zag-core-external',
				resolveId(source, importer) {
					if (source === './index' && importer && /[\\/]src[\\/]zag\.ts$/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // D211: one subpath per Zag part ('sygnal/ui/menu', '…/select', '…/combobox'), so an app installs
  // only the Zag machine it uses. Each part's shared helpers (src/ui/zag/shared.ts) are inlined.
  ...['menu', 'select', 'combobox'].map((part) => ({
    input: `src/ui-${part}.ts`,
    external: (id) => isExternal(id) || /^sygnal(\/zag)?$/.test(id) || /^@zag-js\//.test(id),
    output: [
      { file: pkg.exports[`./ui/${part}`].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports[`./ui/${part}`].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-ui-zag-external',
				resolveId(source, importer) {
					if (!importer || !/[\\/]src[\\/]ui[\\/]zag[\\/]/.test(importer)) return null
					if (source === '../../zag') return { id: 'sygnal/zag', external: true }
					if (source === '../../index') return { id: 'sygnal', external: true }
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  })),

  {
    input: 'src/react.ts',
    external: (id) => isExternal(id) || id === 'sygnal' || /^react(-dom)?(\/|$)/.test(id),
    output: [
      { file: pkg.exports['./react'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./react'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-react-core-external',
				resolveId(source, importer) {
					if (source === './index' && importer && /[\\/]src[\\/]react\.ts$/.test(importer)) {
						return { id: 'sygnal', external: true }
					}
					return null
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
		]
  },

  // sygnal/vite aliases xstream's `globalthis` dependency to this stub (G-099).
  // CommonJS: xstream require()s it. `exports: 'default'` → module.exports = fn.
  {
    input: 'src/vite/globalthis-shim.ts',
    output: { file: 'dist/shims/globalthis.cjs', format: 'cjs', exports: 'default' },
    plugins: [typescript({ tsconfig: './tsconfig.json' })]
  },

  {
    input: 'src/vite/plugin.ts',
    external: [],
    output: [
      { file: pkg.exports['./vite'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./vite'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/astro/index.ts',
    external: [],
    output: [
      { file: pkg.exports['./astro'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./astro'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/astro/client.ts',
    // 'sygnal' stays external so islands run on the app's core (B-019)
    // D120: the virtual onError module is served by the integration's Vite plugin
    external: shimXstream((id) => isExternal(id) || /^sygnal(\/|$)/.test(id) || id.startsWith('virtual:')),
    output: [
      { file: pkg.exports['./astro/client'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./astro/client'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			xstreamInterop(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/astro/server.ts',
    external: (id) => id.startsWith('virtual:'),
    output: [
      { file: pkg.exports['./astro/server'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./astro/server'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    // G-083: Vike resolves `extends` pointer imports with require.resolve(), loads them with
    // import(), and treats an npm import as an extension config only when the file is named
    // `+config.js`. So there is one ESM `+config.js`, in a folder whose package.json says
    // "type": "module" (the root package has no "type"; Node would warn
    // MODULE_TYPELESS_PACKAGE_JSON), and no CommonJS build (import() of one adds a
    // `module.exports` export, which Vike warns about). Vike reads the extension's name and
    // version from the nearest package.json, so that file repeats them.
    input: 'src/vike/+config.ts',
    external: [],
    output: [
      { file: 'dist/vike/config/+config.js', format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			{
				name: 'sygnal-esm-folder',
				generateBundle() {
					const folderPkg = { name: pkg.name, version: pkg.version, private: true, type: 'module' }
					this.emitFile({ type: 'asset', fileName: 'package.json', source: JSON.stringify(folderPkg, null, 2) + '\n' })
				},
			},
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/onRenderHtml.ts',
    external: (id) => /^(vike|sygnal)(\/|$)/.test(id),
    output: [
      { file: pkg.exports['./vike/onRenderHtml'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./vike/onRenderHtml'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/onRenderClient.ts',
    external: shimXstream((id) => /^(vike|sygnal|snabbdom|xstream)(\/|$)/.test(id)),
    output: [
      { file: pkg.exports['./vike/onRenderClient'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./vike/onRenderClient'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			xstreamInterop(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/ClientOnly.ts',
    external: shimXstream((id) => isExternal(id) || /^(vike|sygnal)(\/|$)/.test(id)),
    output: [
      { file: pkg.exports['./vike/ClientOnly'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./vike/ClientOnly'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			xstreamInterop(),
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  }
];
