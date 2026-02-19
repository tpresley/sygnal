import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import pkg from './package.json' assert { type: "json" };

export default [
	// browser-friendly UMD build
	{
		input: 'src/index.js',
		output: {
			name: 'Sygnal',
			file: "./dist/sygnal.min.js",
			format: 'umd'
		},
		plugins: [
			resolve(),
			commonjs(),
      terser({ maxWorkers: 1 })
		]
	},

	{
		input: 'src/index.js',
		external: ['cycle', '@cycle/dom', '@cycle/isolate', '@cycle/run', '@cycle/state', 'snabbdom', 'xstream'],
		output: [
			{ file: pkg.main, format: 'cjs' },
			{ file: pkg.module, format: 'es' }
		],
		plugins: [
			resolve(),
			commonjs()
		]
	},

  {
    input: 'src/jsx.js',
    external: ['extend'],
    output: [
      { file: pkg.exports['./jsx'].require, format: 'cjs' },
      { file: pkg.exports['./jsx'].import, format: 'es' }
    ],
		plugins: [
			resolve(),
			commonjs()
		]
  },

  {
    input: 'src/astro/index.js',
    external: [],
    output: [
      { file: pkg.exports['./astro'].require, format: 'cjs' },
      { file: pkg.exports['./astro'].import, format: 'es' }
    ],
		plugins: [
			resolve(),
			commonjs()
		]
  },

  {
    input: 'src/astro/client.js',
    external: ['@cycle/run', '@cycle/state', '@cycle/dom', '@cycle/isolate', 'xstream', 'snabbdom'],
    output: [
      { file: pkg.exports['./astro/client'].require, format: 'cjs' },
      { file: pkg.exports['./astro/client'].import, format: 'es' }
    ],
		plugins: [
			resolve(),
			commonjs()
		]
  },

  {
    input: 'src/astro/server.js',
    external: [],
    output: [
      { file: pkg.exports['./astro/server'].require, format: 'cjs' },
      { file: pkg.exports['./astro/server'].import, format: 'es' }
    ],
		plugins: [
			resolve(),
			commonjs()
		]
  }
];
