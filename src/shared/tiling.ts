export interface GridDims { rows: number; cols: number }

/** cols = ceil(sqrt(n)); rows = ceil(n / cols). */
export function gridDims(n: number): GridDims {
  if (n <= 0) return { rows: 0, cols: 0 }
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { rows, cols }
}
