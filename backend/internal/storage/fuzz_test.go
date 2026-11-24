package storage

import "testing"

// Gap computation drives how many upstream calls we make: it must never return an
// inverted/empty/out-of-request range, whatever the cached coverage looks like.
func FuzzComputeMissingGaps(f *testing.F) {
	f.Add(int64(20000), int64(40000), int64(3), int64(10000), int64(50000), int64(1000))
	f.Add(int64(0), int64(0), int64(0), int64(5), int64(1), int64(0))
	f.Fuzz(func(t *testing.T, mn, mx, count, from, to, tf int64) {
		gaps := ComputeMissingGaps(mn, mx, count, from, to, tf)
		if to <= from && len(gaps) != 0 {
			t.Fatalf("empty request produced gaps %+v", gaps)
		}
		for _, g := range gaps {
			if g.To <= g.From {
				t.Fatalf("inverted gap %+v", g)
			}
			if g.From < from || g.To > to {
				t.Fatalf("gap %+v outside request [%d,%d]", g, from, to)
			}
		}
	})
}
