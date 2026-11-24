// Command libtitan builds the Go server as a C library for the Tauri phone
// app (Faz 33): `-buildmode=c-shared` (Android, libtitan.so per ABI) or
// `-buildmode=c-archive` (iOS, libtitan.a). See scripts/build-mobile-core.mjs.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"encoding/json"
	"unsafe"

	"github.com/ersincebi/titanview/backend/mobile"
)

// TitanStart starts the in-process server. It returns a malloc'ed JSON string,
// {"base":"http://127.0.0.1:P","token":"…"} or {"error":"…"}, which the caller
// must release with TitanFree.
//
//export TitanStart
func TitanStart(dataDir *C.char) *C.char {
	out, err := mobile.Start(C.GoString(dataDir))
	if err != nil {
		b, _ := json.Marshal(map[string]string{"error": err.Error()})
		out = string(b)
	}
	return C.CString(out)
}

// TitanStop stops the server.
//
//export TitanStop
func TitanStop() { mobile.Stop() }

// TitanFree releases a string returned by TitanStart.
//
//export TitanFree
func TitanFree(p *C.char) { C.free(unsafe.Pointer(p)) }

func main() {}
