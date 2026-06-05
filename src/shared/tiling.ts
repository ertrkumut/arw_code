import type { LayoutMode } from './types'

export interface GridDims { rows: number; cols: number }

/** cols = ceil(sqrt(n)); rows = ceil(n / cols). */
export function gridDims(n: number): GridDims {
  if (n <= 0) return { rows: 0, cols: 0 }
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return { rows, cols }
}

/** Grid dimensions for a layout mode. vertical = single column (stacked),
 *  horizontal = single row (side-by-side), grid = auto square-ish tiling. */
export function tileDims(mode: LayoutMode, n: number): GridDims {
  if (n <= 0) return { rows: 0, cols: 0 }
  if (mode === 'vertical') return { rows: n, cols: 1 }
  if (mode === 'horizontal') return { rows: 1, cols: n }
  return gridDims(n)
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b) }
function lcm(a: number, b: number): number { return (a / gcd(a, b)) * b }

export interface TileLayout {
  /** base column count for grid-template-columns: repeat(cols, 1fr) */
  cols: number
  /** row count for grid-template-rows: repeat(rows, 1fr) */
  rows: number
  /** column span (in base columns) for the pane at each index, length n */
  spans: number[]
}

/** Full tiling plan including per-pane column spans. When the last row holds
 *  fewer panes than a full row, those panes stretch to fill the row evenly
 *  (e.g. 3 panes -> 2 on top, 1 spanning the full bottom; 5 panes -> 3 on top,
 *  2 each spanning half the bottom). The base column count is lcm(full, last)
 *  so both full rows and the partial row divide into whole spans. */
export function tileLayout(mode: LayoutMode, n: number): TileLayout {
  const { rows, cols } = tileDims(mode, n)
  if (n <= 0) return { rows, cols, spans: [] }
  const full = cols                      // panes in a full row
  const last = n - (rows - 1) * full     // panes in the last (possibly partial) row
  const baseCols = lcm(full, last)
  const fullSpan = baseCols / full
  const lastSpan = baseCols / last
  const lastRowStart = (rows - 1) * full
  const spans = Array.from({ length: n }, (_, i) => (i >= lastRowStart ? lastSpan : fullSpan))
  return { rows, cols: baseCols, spans }
}
