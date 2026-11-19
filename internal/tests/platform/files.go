package platform

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(filesTest{}) }

// filesTest creates, reads back and deletes thousands of small files — the
// shape of a package install, a git checkout or an untar. It is bound by
// filesystem metadata, not by device throughput, and layered or network
// filesystems under a sandbox are often an order of magnitude slower here.
type filesTest struct{}

func (filesTest) Name() string     { return "files" }
func (filesTest) Category() string { return Category }
func (filesTest) Description() string {
	return "Small-file metadata: create, read back and delete thousands of 4 KiB files"
}

const smallFileSize = 4096

func (filesTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("files")
	parent := opts.Dir
	if parent == "" {
		parent = "."
	}
	dir, err := os.MkdirTemp(parent, ".providerbench-files-")
	if err != nil {
		return nil, fmt.Errorf("files: create scratch directory: %w", err)
	}
	defer os.RemoveAll(dir)

	count := 10000
	if opts.Quick {
		count = 2000
	}
	if durationOverride > 0 {
		count = 200
	}
	names := make([]string, count)
	for i := range names {
		names[i] = filepath.Join(dir, fmt.Sprintf("f%06d", i))
	}
	payload := make([]byte, smallFileSize)
	rand.New(rand.NewSource(3)).Read(payload)

	timed := func(label string, order []int, op func(i int) error) (float64, error) {
		opts.Logf("files: %s %d files...", label, count)
		start := time.Now()
		for _, i := range order {
			if i&255 == 0 {
				if err := ctx.Err(); err != nil {
					return 0, err
				}
			}
			if err := op(i); err != nil {
				return 0, fmt.Errorf("%s: %w", label, err)
			}
		}
		elapsed := time.Since(start).Seconds()
		if elapsed <= 0 {
			return 0, fmt.Errorf("%s: no measurable duration", label)
		}
		return float64(len(order)) / elapsed, nil
	}

	inOrder := make([]int, count)
	for i := range inOrder {
		inOrder[i] = i
	}
	// Reads and deletes visit the files in a fixed shuffled order, so the
	// filesystem cannot answer from a sequential directory scan.
	shuffled := rand.New(rand.NewSource(5)).Perm(count)

	created, err := timed("create", inOrder, func(i int) error {
		// Stamp the index so no two files share content.
		binary.LittleEndian.PutUint64(payload, uint64(i))
		f, err := os.OpenFile(names[i], os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		if _, err := f.Write(payload); err != nil {
			f.Close()
			return err
		}
		return f.Close()
	})
	if err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}

	read, err := timed("read", shuffled, func(i int) error {
		data, err := os.ReadFile(names[i])
		if err != nil {
			return err
		}
		if len(data) != smallFileSize || binary.LittleEndian.Uint64(data) != uint64(i) {
			return errors.New("file content does not match what was written")
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}

	deleted, err := timed("delete", shuffled, func(i int) error {
		return os.Remove(names[i])
	})
	if err != nil {
		return nil, fmt.Errorf("files: %w", err)
	}

	res.Add("file_create", created, "ops/s", true)
	res.Add("file_read", read, "ops/s", true)
	res.Add("file_delete", deleted, "ops/s", true)
	res.Note("%d files of %d bytes in one directory under %s; no fsync, like a package install", count, smallFileSize, parent)
	res.Finish()
	return res, ctx.Err()
}
