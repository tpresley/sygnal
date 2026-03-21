export interface SygnalPluginOptions {
  /**
   * Disable automatic JSX configuration.
   * @default false
   */
  disableJsx?: boolean

  /**
   * Disable automatic HMR wiring.
   * @default false
   */
  disableHmr?: boolean
}

/**
 * Sygnal Vite plugin.
 *
 * Auto-configures JSX transform and injects HMR boilerplate.
 *
 * @example
 * ```js
 * import sygnal from 'sygnal/vite'
 * export default defineConfig({ plugins: [sygnal()] })
 * ```
 */
export default function sygnal(options?: SygnalPluginOptions): {
  name: string
  config: (config: any, env: { command: string }) => any
  transform: (code: string, id: string) => { code: string; map: null } | null
}
