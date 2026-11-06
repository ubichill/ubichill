//go:build !windows

package logging

import "os"

func enableANSI(*os.File) bool { return true }
