import { describe, it, expect } from 'vitest'
import { gridDims, tileDims, tileLayout } from '@shared/tiling'

describe('gridDims', () => {
  it('1 terminal -> 1x1', () => expect(gridDims(1)).toEqual({ rows: 1, cols: 1 }))
  it('2 terminals -> 1 row, 2 cols', () => expect(gridDims(2)).toEqual({ rows: 1, cols: 2 }))
  it('3 terminals -> 2x2', () => expect(gridDims(3)).toEqual({ rows: 2, cols: 2 }))
  it('4 terminals -> 2x2', () => expect(gridDims(4)).toEqual({ rows: 2, cols: 2 }))
  it('5-6 terminals -> 2 rows, 3 cols', () => {
    expect(gridDims(5)).toEqual({ rows: 2, cols: 3 })
    expect(gridDims(6)).toEqual({ rows: 2, cols: 3 })
  })
  it('7-9 terminals -> 3x3', () => expect(gridDims(9)).toEqual({ rows: 3, cols: 3 }))
  it('0 terminals -> 0x0', () => expect(gridDims(0)).toEqual({ rows: 0, cols: 0 }))
})

describe('tileDims (layout-aware)', () => {
  it('guards n <= 0 in every mode', () => {
    for (const m of ['grid', 'vertical', 'horizontal'] as const) {
      expect(tileDims(m, 0)).toEqual({ rows: 0, cols: 0 })
    }
  })

  it('grid mode matches gridDims exactly', () => {
    for (const n of [1, 2, 3, 4, 5, 9]) {
      expect(tileDims('grid', n)).toEqual(gridDims(n))
    }
  })

  it('vertical mode stacks panes in a single column', () => {
    expect(tileDims('vertical', 1)).toEqual({ rows: 1, cols: 1 })
    expect(tileDims('vertical', 2)).toEqual({ rows: 2, cols: 1 })
    expect(tileDims('vertical', 4)).toEqual({ rows: 4, cols: 1 })
  })

  it('horizontal mode lays panes out in a single row', () => {
    expect(tileDims('horizontal', 1)).toEqual({ rows: 1, cols: 1 })
    expect(tileDims('horizontal', 2)).toEqual({ rows: 1, cols: 2 })
    expect(tileDims('horizontal', 4)).toEqual({ rows: 1, cols: 4 })
  })
})

describe('tileLayout (partial-row stretching)', () => {
  it('3 panes: 2 on top, 3rd spans the full bottom row', () => {
    // base 2 cols; top two span 1 each, bottom one spans 2 (full width)
    expect(tileLayout('grid', 3)).toEqual({ rows: 2, cols: 2, spans: [1, 1, 2] })
  })

  it('5 panes: 3 on top, bottom 2 each span half the width', () => {
    // base lcm(3,2)=6 cols; top three span 2 each, bottom two span 3 each (50%)
    expect(tileLayout('grid', 5)).toEqual({ rows: 2, cols: 6, spans: [2, 2, 2, 3, 3] })
  })

  it('full grids keep uniform single-column spans', () => {
    expect(tileLayout('grid', 1)).toEqual({ rows: 1, cols: 1, spans: [1] })
    expect(tileLayout('grid', 2)).toEqual({ rows: 1, cols: 2, spans: [1, 1] })
    expect(tileLayout('grid', 4)).toEqual({ rows: 2, cols: 2, spans: [1, 1, 1, 1] })
  })

  it('7 panes: two full rows of 3, last pane spans the full bottom', () => {
    expect(tileLayout('grid', 7)).toEqual({ rows: 3, cols: 3, spans: [1, 1, 1, 1, 1, 1, 3] })
  })

  it('8 panes: two rows of 3, bottom two each span half', () => {
    expect(tileLayout('grid', 8)).toEqual({ rows: 3, cols: 6, spans: [2, 2, 2, 2, 2, 2, 3, 3] })
  })

  it('vertical and horizontal modes never stretch (every row is full)', () => {
    expect(tileLayout('vertical', 3)).toEqual({ rows: 3, cols: 1, spans: [1, 1, 1] })
    expect(tileLayout('horizontal', 3)).toEqual({ rows: 1, cols: 3, spans: [1, 1, 1] })
  })

  it('0 panes -> empty spans', () => {
    expect(tileLayout('grid', 0)).toEqual({ rows: 0, cols: 0, spans: [] })
  })
})
