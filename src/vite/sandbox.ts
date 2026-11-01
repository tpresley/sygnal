/**
 * sygnal/sandbox's guest kernel in sygnal/vite (README §7 (a), D209): `import kernel from
 * 'sygnal/sandbox/kernel?raw'` (or without `?raw`) resolves to a module whose default export is
 * the kernel script, built once per server or build with the project's own Vite from the
 * installed sygnal, xstream and snabbdom (src/sandbox/build.ts). Nothing is shipped prebuilt.
 */
import { buildSandboxKernel } from '../sandbox/build'

export const SANDBOX_KERNEL = /^sygnal\/sandbox\/kernel(\?raw)?$/
export const SANDBOX_KERNEL_ID = '\0sygnal-sandbox-kernel'

const built = new Map<string, Promise<string>>()
export async function sandboxKernelModule(root: string): Promise<string> {
  if (!built.has(root)) built.set(root, buildSandboxKernel({ root, bundler: 'vite' }))
  return `// sygnal/sandbox's guest kernel, built from the installed packages (sygnal/vite)\nexport default ${JSON.stringify(await built.get(root))};\n`
}
