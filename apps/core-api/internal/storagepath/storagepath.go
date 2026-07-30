package storagepath

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var ErrUnsafe = errors.New("unsafe storage path")

func Existing(root, key string) (string, error) {
	return resolve(root, key, true)
}

func Removable(root, key string) (string, error) {
	return resolve(root, key, false)
}

func Writable(root, key string) (string, error) {
	lexical, err := lexicalPath(root, key)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(lexical), 0o755); err != nil {
		return "", err
	}
	if _, err := os.Lstat(lexical); err == nil {
		return "", ErrUnsafe
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return resolve(root, key, false)
}

func resolve(root, key string, mustExist bool) (string, error) {
	lexical, err := lexicalPath(root, key)
	if err != nil {
		return "", err
	}
	if err := rejectSpecialComponents(root, lexical); err != nil {
		return "", err
	}
	actualRoot, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil {
		return "", err
	}
	actualTarget, err := filepath.EvalSymlinks(lexical)
	if errors.Is(err, os.ErrNotExist) && !mustExist {
		actualParent, parentErr := filepath.EvalSymlinks(filepath.Dir(lexical))
		if parentErr != nil {
			return "", parentErr
		}
		actualTarget = filepath.Join(actualParent, filepath.Base(lexical))
	} else if err != nil {
		return "", err
	}
	if !contained(actualRoot, actualTarget) {
		return "", ErrUnsafe
	}
	if info, err := os.Stat(actualTarget); err == nil {
		if info.Mode()&os.ModeIrregular != 0 {
			return "", ErrUnsafe
		}
	} else if mustExist || !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return actualTarget, nil
}

func rejectSpecialComponents(root, target string) error {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil || !contained(root, target) {
		return ErrUnsafe
	}
	current := filepath.Clean(root)
	for _, part := range strings.Split(relative, string(os.PathSeparator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 || isReparsePoint(info) {
			return ErrUnsafe
		}
	}
	return nil
}

func lexicalPath(root, key string) (string, error) {
	if key == "" || filepath.IsAbs(key) || strings.Contains(key, `\`) {
		return "", ErrUnsafe
	}
	root = filepath.Clean(root)
	target := filepath.Clean(filepath.Join(root, filepath.FromSlash(key)))
	if target == root || !contained(root, target) {
		return "", ErrUnsafe
	}
	return target, nil
}

func contained(root, target string) bool {
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	return err == nil && relative != ".." && !filepath.IsAbs(relative) &&
		!strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}
