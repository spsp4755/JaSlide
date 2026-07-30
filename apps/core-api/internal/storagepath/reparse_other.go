//go:build !windows

package storagepath

import "os"

func isReparsePoint(os.FileInfo) bool {
	return false
}
