// 'sygnal/sandbox/build' (Node): the guest kernel for sygnal/sandbox, built from the app's installed
// packages. With sygnal/vite, `import kernel from 'sygnal/sandbox/kernel?raw'` does this for you.
export interface BuildSandboxKernelOptions {
  /** where the app's packages are installed (default process.cwd()) */
  root?: string
  /** 'auto' (default): the project's Vite, else esbuild, else Rollup */
  bundler?: 'auto' | 'vite' | 'esbuild' | 'rollup'
  /** default true */
  minify?: boolean
}
/** The kernel script createSandbox / <Sandboxed> take as `kernel` (one string; cache it) */
export function buildSandboxKernel(options?: BuildSandboxKernelOptions): Promise<string>
