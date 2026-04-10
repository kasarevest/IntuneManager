import { describe, it, expect } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  // ── Standard semver ─────────────────────────────────────────────────────────
  it('detects update when latest is newer (3-part)', () => {
    expect(compareVersions('1.2.3', '1.2.2')).toBe('update-available')
  })

  it('returns current when versions are equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe('current')
  })

  it('returns current when Intune version is newer', () => {
    expect(compareVersions('1.2.2', '1.2.3')).toBe('current')
  })

  // ── v-prefix (SCRUM-73 / SCRUM-75) ──────────────────────────────────────────
  it('strips v prefix on latest', () => {
    expect(compareVersions('v1.2.4', '1.2.3')).toBe('update-available')
  })

  it('strips v prefix on intune version', () => {
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe('current')
  })

  it('strips V prefix (uppercase)', () => {
    expect(compareVersions('V2.0.0', '1.9.9')).toBe('update-available')
  })

  // ── Pre-release suffix (SCRUM-75) ────────────────────────────────────────────
  it('strips -beta suffix before comparing', () => {
    expect(compareVersions('1.2.3-beta', '1.2.2')).toBe('update-available')
  })

  it('strips +build metadata suffix', () => {
    expect(compareVersions('1.2.3+build.42', '1.2.3')).toBe('current')
  })

  // ── Quad-part versions (SCRUM-74 — Chromium / Edge) ─────────────────────────
  it('detects update for quad-part versions', () => {
    expect(compareVersions('132.0.6834.83', '131.0.6778.30')).toBe('update-available')
  })

  it('returns current for equal quad-part versions', () => {
    expect(compareVersions('132.0.6834.83', '132.0.6834.83')).toBe('current')
  })

  it('detects update on 4th part only', () => {
    expect(compareVersions('132.0.6834.84', '132.0.6834.83')).toBe('update-available')
  })

  // ── Mixed triple / quad (SCRUM-75) ───────────────────────────────────────────
  it('treats trailing .0 as equal (3-part vs 4-part)', () => {
    expect(compareVersions('3.2.1', '3.2.1.0')).toBe('current')
  })

  it('detects update when 4th part is non-zero', () => {
    expect(compareVersions('3.2.1.1', '3.2.1')).toBe('update-available')
  })

  // ── Date-based versions (SCRUM-73 — YYYYMMDD) ───────────────────────────────
  it('detects update for date-based versions', () => {
    expect(compareVersions('20250101', '20241201')).toBe('update-available')
  })

  it('returns current for equal date-based versions', () => {
    expect(compareVersions('20241201', '20241201')).toBe('current')
  })

  it('returns current when Intune date is newer', () => {
    expect(compareVersions('20241101', '20241201')).toBe('current')
  })

  // ── Mixed date / semver → unknown (SCRUM-75) ─────────────────────────────────
  it('returns unknown when formats are incompatible (date vs semver)', () => {
    expect(compareVersions('20241201', '1.2.3')).toBe('unknown')
  })

  it('returns unknown when formats are incompatible (semver vs date)', () => {
    expect(compareVersions('1.2.3', '20241201')).toBe('unknown')
  })
})
