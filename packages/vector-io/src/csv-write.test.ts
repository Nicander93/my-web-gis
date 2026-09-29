import { describe, expect, it } from 'vitest'
import {
  escapeCsvField,
  featuresToCsv,
  guardSpreadsheetFormula,
  needsFormulaGuard
} from './csv-write.js'

describe('CSV write / formula guard', () => {
  it('escapes quotes, commas, and newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('detects and guards spreadsheet formula prefixes', () => {
    expect(needsFormulaGuard('=1+2')).toBe(true)
    expect(needsFormulaGuard('+cmd')).toBe(true)
    expect(needsFormulaGuard('-1')).toBe(true)
    expect(needsFormulaGuard('@sum')).toBe(true)
    expect(needsFormulaGuard('\tTAB')).toBe(true)
    expect(needsFormulaGuard('normal')).toBe(false)
    expect(guardSpreadsheetFormula('=1+2')).toBe("'=1+2")
    expect(guardSpreadsheetFormula('ok')).toBe('ok')
  })

  it('returns null for empty scope (no misleading file)', () => {
    expect(featuresToCsv([])).toBeNull()
  })

  it('writes id + properties with formula guard by default', () => {
    const csv = featuresToCsv([
      {
        id: 'f1',
        properties: { name: 'Alpha', note: '=cmd()', label: 'a,b' },
        geometry: { type: 'Point', coordinates: [1, 2] }
      },
      {
        id: 'f2',
        properties: { name: 'Beta', note: 'safe', label: 'x' },
        geometry: { type: 'Point', coordinates: [3, 4] }
      }
    ])
    expect(csv).toBeTruthy()
    const lines = csv!.split('\n')
    expect(lines[0]).toBe('id,label,name,note')
    expect(lines[1]).toContain("'=cmd()")
    expect(lines[1]).toContain('"a,b"')
    expect(lines).toHaveLength(3)
  })

  it('can disable formula guard', () => {
    const csv = featuresToCsv(
      [{ id: 'f1', properties: { note: '=1+2' } }],
      { formulaGuard: false }
    )
    expect(csv!.split('\n')[1]).toBe('f1,=1+2')
  })

  it('optionally includes point x/y', () => {
    const csv = featuresToCsv(
      [{ id: 'p', properties: { n: 'A' }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }],
      { includePointXY: true }
    )
    expect(csv!.split('\n')[0]).toBe('id,x,y,n')
    expect(csv!.split('\n')[1]).toBe('p,116.4,39.9,A')
  })
})
