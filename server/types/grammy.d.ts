// T-P3-2: Type declaration for grammy context extension
declare module 'grammy' {
  interface Context {
    config: { isAdmin: boolean; lang: string }
  }
}
