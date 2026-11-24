package storage

import (
	"context"
	"errors"
	"testing"
)

func TestScriptVersionsRenameAndDelete(t *testing.T) {
	st, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	save := func(code string) {
		t.Helper()
		if err := st.SaveScript(ctx, SavedScript{ID: "s1", Name: "A", Code: code}); err != nil {
			t.Fatal(err)
		}
	}
	save("v1")
	save("v1") // aynı kod → yeni sürüm yok
	save("v2")
	vs, err := st.ListScriptVersions(ctx, "s1")
	if err != nil || len(vs) != 2 || vs[0].Version != 2 || vs[0].Code != "v2" || vs[1].Code != "v1" {
		t.Fatalf("versions: %+v %v", vs, err)
	}
	if err := st.RenameScript(ctx, "s1", "B"); err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListScripts(ctx)
	if len(list) != 1 || list[0].Name != "B" {
		t.Fatalf("rename: %+v", list)
	}
	if err := st.RenameScript(ctx, "nope", "x"); !errors.Is(err, ErrScriptNotFound) {
		t.Fatalf("want not found, got %v", err)
	}
	if err := st.DeleteScript(ctx, "s1"); err != nil {
		t.Fatal(err)
	}
	vs, _ = st.ListScriptVersions(ctx, "s1")
	if len(vs) != 0 {
		t.Fatalf("versions survive delete: %+v", vs)
	}
}

func TestScriptVersionsPruned(t *testing.T) {
	st, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	for i := 0; i < MaxScriptVersions+5; i++ {
		if err := st.SaveScript(ctx, SavedScript{ID: "s", Name: "n", Code: string(rune('a'+i%26)) + string(rune(i))}); err != nil {
			t.Fatal(err)
		}
	}
	vs, _ := st.ListScriptVersions(ctx, "s")
	if len(vs) != MaxScriptVersions || vs[0].Version != MaxScriptVersions+5 || vs[len(vs)-1].Version != 6 {
		t.Fatalf("prune: n=%d first=%d last=%d", len(vs), vs[0].Version, vs[len(vs)-1].Version)
	}
}
