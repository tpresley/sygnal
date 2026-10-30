import {defineConfig} from 'vitest/config'
import {shared, deps} from '../vitest.config.mjs'

export default defineConfig({...shared, test: {...deps, environment: 'jsdom', setupFiles: ['test/setup.js'], include: ['bench/*.bench.test.js'], testTimeout: 300000, fileParallelism: false}})
