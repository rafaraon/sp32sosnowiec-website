import { describe, it, expect } from 'vitest'
import { calcGraduationYear } from './types'

describe('calcGraduationYear', () => {
  it('klasa 3a, rok 2024/2025 → 2030', () => {
    expect(calcGraduationYear('2024/2025', '3a')).toBe(2030)
  })
  it('klasa 8b, rok 2024/2025 → 2025', () => {
    expect(calcGraduationYear('2024/2025', '8b')).toBe(2025)
  })
  it('klasa 1c, rok 2025/2026 → 2033', () => {
    expect(calcGraduationYear('2025/2026', '1c')).toBe(2033)
  })
  it('ogólnoszkolne (null), rok 2024/2025 → 2025', () => {
    expect(calcGraduationYear('2024/2025', null)).toBe(2025)
  })
})
