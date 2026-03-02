import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxInject: `import { jsx, Fragment } from 'sygnal/jsx'`,
    jsxFactory: 'jsx',
    jsxFragment: 'Fragment'
  },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
