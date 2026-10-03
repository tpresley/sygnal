import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import pkg from './package.json' with { type: "json" };

const isExternal = (id) => /^(snabbdom|xstream)(\/|$)/.test(id);

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
    external: ['extend'],
    output: [
      { file: pkg.exports['./jsx'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/jsx-runtime.ts',
    external: ['extend'],
    output: [
      { file: pkg.exports['./jsx-runtime'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx-runtime'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/jsx-dev-runtime.ts',
    external: ['extend'],
    output: [
      { file: pkg.exports['./jsx-dev-runtime'].require, format: 'cjs', ...sourcemapOptions },
      { file: pkg.exports['./jsx-dev-runtime'].import, format: 'es', ...sourcemapOptions }
    ],
		plugins: [
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
