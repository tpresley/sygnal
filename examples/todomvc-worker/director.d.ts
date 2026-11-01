declare module 'director/build/director' {
  export class Router {
    configure(options: Record<string, any>): void
    init(): void
    on(route: string, handler: () => void): void
  }
}
