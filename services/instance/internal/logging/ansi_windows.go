package logging

import (
	"os"

	"golang.org/x/sys/windows"
)

// enableANSI はコンソールに ANSI の色を解釈させる（既定では解釈せず、エスケープがそのまま見える）。
// 古いコンソールで有効にできなければ色を付けない。
func enableANSI(f *os.File) bool {
	h := windows.Handle(f.Fd())
	var mode uint32
	if windows.GetConsoleMode(h, &mode) != nil {
		return false
	}
	return windows.SetConsoleMode(h, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING) == nil
}
