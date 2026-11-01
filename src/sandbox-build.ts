/*
 * 'sygnal/sandbox/build' (Node): buildSandboxKernel(), the guest kernel for sygnal/sandbox built
 * from the app's installed packages with its Vite, esbuild or Rollup. sygnal/vite does the same
 * for `import kernel from 'sygnal/sandbox/kernel?raw'`.
 */
export {buildSandboxKernel} from './sandbox/build'
