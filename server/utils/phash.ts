/**
 * Perceptual hash utilities — Hamming distance for duplicate detection.
 * ponytail: simple hex XOR + popcount, no native addon needed.
 */

export function hammingDistance(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a.length !== b.length) return Infinity
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    if (isNaN(xor)) return Infinity // non-hex char → can't compare
    distance += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1)
  }
  return distance
}

/** Find duplicate by phash prefix bucket + Hamming distance ≤ threshold */
export function findDuplicateByPhash(
  candidates: { id: string; phash: string }[],
  targetPhash: string,
  threshold = 8,
): string | null {
  for (const c of candidates) {
    if (hammingDistance(targetPhash, c.phash) <= threshold) {
      return c.id
    }
  }
  return null
}
