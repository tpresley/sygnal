/**
 * App-level EVENTS registry via module augmentation (what a user would write).
 *
 * This directory is compiled as its own program (tsconfig.json → src types,
 * tsconfig.dist.json → the bundled dist/index.d.ts) because the augmentation is
 * global to a program and would change the untyped behavior tested in ../typed-links.tsx.
 */
export {}

declare module 'sygnal' {
  interface SygnalEvents {
    DELETE_LANE: { laneId: string }
    RESET: void
    SET_MODE: 'light' | 'dark'
    COUNT: number
  }
}
