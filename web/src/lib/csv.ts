/**
 * Minimal CSV support for a fixed, self-controlled template (no quoted-comma
 * escaping) — sufficient for the portfolio upload's own "baixar modelo" file
 * and simple user-edited spreadsheets without commas inside field values.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (cell: string | number) => {
    const str = String(cell)
    return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const lines = [headers.join(','), ...rows.map((r) => r.map(escapeCell).join(','))]
  return lines.join('\n')
}

export function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([`﻿${csvText}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
