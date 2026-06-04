import { describe, it, expect } from 'vitest'
import { gridDims } from '@shared/tiling'

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
