//go:build windows

package storagepath

import (
	"os"
	"syscall"
)

const fileAttributeReparsePoint = 0x400

func isReparsePoint(info os.FileInfo) bool {
	attributes, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return ok && attributes.FileAttributes&fileAttributeReparsePoint != 0
}
