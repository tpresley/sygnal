// built with the platformer example's Vite: node ../../../../examples/platformer/node_modules/vite/bin/vite.js build --config vite.config.js
export default {root: new URL('.', import.meta.url).pathname, build: {outDir: 'dist', sourcemap: true}, server: {fs: {allow: ['../../../..']}}}
