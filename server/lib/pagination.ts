const ALLOWED = [20, 40, 100]

export function clampPerPage(n?: number): number {
  if (!n || !ALLOWED.includes(n)) return 40
  return n
}
