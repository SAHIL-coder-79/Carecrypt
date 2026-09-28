// Complementary (secondary) suppression for aggregate tables.
//
// The database views already hide every cell with fewer than k patients
// (primary suppression). That alone is not enough when a table's total is also
// published: with one hidden district, "total - visible districts" gives the
// hidden district's exact count. For each group of cells that adds up to a
// published total, this hides further cells until
//   - no group has exactly one hidden cell, and
//   - the cases hidden in a group, as an outsider could work them out from the
//     published total, are either none or at least k.
// Cells hidden here are marked suppression: 'COMPLEMENTARY'.
//
// Input rows come straight from the views: { patient_count, case_count, is_suppressed, ... }.
// Output rows are copies with { patientCount, caseCount, suppressed, suppression }.

export function toCell(row) {
  const { patient_count: patientCount, case_count: caseCount, is_suppressed: suppressed, min_group_size: _k, ...rest } = row
  return {
    ...rest,
    patientCount: suppressed ? null : Number(patientCount),
    caseCount: suppressed ? null : Number(caseCount),
    suppressed: Boolean(suppressed),
    suppression: suppressed ? 'SMALL_GROUP' : null,
  }
}

// cells:     output of toCell()
// groupings: [{ key: (cell) => string, total: (key) => number | null }]
//            total() returns the published case total for that group, or null
//            when none is published. Use key: () => 'all' for the whole table.
// k:         minimum group size
export function protect(cells, groupings, k) {
  const out = cells.map((c) => ({ ...c }))
  let changed = true
  while (changed) {
    changed = false
    for (const { key, total } of groupings) {
      const groups = new Map()
      for (const cell of out) {
        const g = key(cell)
        if (!groups.has(g)) groups.set(g, [])
        groups.get(g).push(cell)
      }
      for (const [g, members] of groups) {
        const hidden = members.filter((c) => c.suppressed)
        const visible = members.filter((c) => !c.suppressed)
        if (hidden.length === 0 || visible.length === 0) continue
        const published = total(g)
        const remainder = published == null ? null : published - visible.reduce((sum, c) => sum + c.caseCount, 0)
        if (hidden.length === 1 || (remainder !== null && remainder < k)) {
          hide(smallest(visible))
          changed = true
        }
      }
    }
  }
  return out
}

function smallest(cells) {
  return cells.reduce((a, b) => (b.caseCount < a.caseCount || (b.caseCount === a.caseCount && b.patientCount < a.patientCount) ? b : a))
}

function hide(cell) {
  cell.patientCount = null
  cell.caseCount = null
  cell.suppressed = true
  cell.suppression = 'COMPLEMENTARY'
}

export function countSuppressed(...tables) {
  return tables.flat().filter((c) => c.suppressed).length
}
