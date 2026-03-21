import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import pkg from './package.json' with { type: "json" };

const isExternal = (id) => /^(snabbdom|xstream)(\/|$)/.test(id);

export default [
	// browser-friendly UMD build
	{
		input: 'src/index.ts',
		output: {
			name: 'Sygnal',
			file: "./dist/sygnal.min.js",
			format: 'umd'
		},
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs(),
      terser({ maxWorkers: 1 })
		]
	},

	{
		input: 'src/index.ts',
		external: isExternal,
		output: [
			{ file: pkg.main, format: 'cjs' },
			{ file: pkg.module, format: 'es' }
		],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
	},

  {
    input: 'src/jsx.ts',
    external: ['extend'],
    output: [
      { file: pkg.exports['./jsx'].require, format: 'cjs' },
      { file: pkg.exports['./jsx'].import, format: 'es' }
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
      { file: pkg.exports['./jsx-runtime'].require, format: 'cjs' },
      { file: pkg.exports['./jsx-runtime'].import, format: 'es' }
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
      { file: pkg.exports['./jsx-dev-runtime'].require, format: 'cjs' },
      { file: pkg.exports['./jsx-dev-runtime'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vite/plugin.ts',
    external: [],
    output: [
      { file: pkg.exports['./vite'].require, format: 'cjs' },
      { file: pkg.exports['./vite'].import, format: 'es' }
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
      { file: pkg.exports['./astro'].require, format: 'cjs' },
      { file: pkg.exports['./astro'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/astro/client.ts',
    external: (id) => /^snabbdom(\/|$)/.test(id),
    output: [
      { file: pkg.exports['./astro/client'].require, format: 'cjs' },
      { file: pkg.exports['./astro/client'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/astro/server.ts',
    external: [],
    output: [
      { file: pkg.exports['./astro/server'].require, format: 'cjs' },
      { file: pkg.exports['./astro/server'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/+config.ts',
    external: [],
    output: [
      { file: 'dist/vike/+config.cjs.js', format: 'cjs' },
      { file: 'dist/vike/+config.js', format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/onRenderHtml.ts',
    external: (id) => /^(vike|sygnal)(\/|$)/.test(id),
    output: [
      { file: pkg.exports['./vike/onRenderHtml'].require, format: 'cjs' },
      { file: pkg.exports['./vike/onRenderHtml'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  },

  {
    input: 'src/vike/onRenderClient.ts',
    external: (id) => /^(vike|sygnal|snabbdom|xstream)(\/|$)/.test(id),
    output: [
      { file: pkg.exports['./vike/onRenderClient'].require, format: 'cjs' },
      { file: pkg.exports['./vike/onRenderClient'].import, format: 'es' }
    ],
		plugins: [
			typescript({ tsconfig: './tsconfig.json' }),
			resolve({ extensions: ['.mjs', '.js', '.ts', '.json'] }),
			commonjs()
		]
  }
];
