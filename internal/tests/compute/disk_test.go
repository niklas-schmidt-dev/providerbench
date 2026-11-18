package compute

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

type fakeFsyncFile struct {
	writeErr error
	syncErr  error
	short    bool
}

func (f fakeFsyncFile) WriteAt(page []byte, _ int64) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	if f.short {
		return len(page) - 1, nil
	}
	return len(page), nil
}

func (f fakeFsyncFile) Sync() error {
	return f.syncErr
}

type fakeReaderAt struct {
	err   error
	short bool
}

func (r fakeReaderAt) ReadAt(buffer []byte, _ int64) (int, error) {
	if r.err != nil {
		return 0, r.err
	}
	if r.short {
		return len(buffer) - 1, nil
	}
	for i := range buffer {
		buffer[i] = 1
	}
	return len(buffer), nil
}

func TestMeasureFsyncLatencyPropagatesWriteError(t *testing.T) {
	_, err := measureFsyncLatency(
		context.Background(),
		fakeFsyncFile{writeErr: errors.New("write failed")},
		make([]byte, diskAlign),
		2,
	)
	if err == nil || !strings.Contains(err.Error(), "write failed") {
		t.Fatalf("write error not propagated: %v", err)
	}
}

func TestMeasureFsyncLatencyPropagatesSyncError(t *testing.T) {
	_, err := measureFsyncLatency(
		context.Background(),
		fakeFsyncFile{syncErr: errors.New("sync failed")},
		make([]byte, diskAlign),
		2,
	)
	if err == nil || !strings.Contains(err.Error(), "sync failed") {
		t.Fatalf("sync error not propagated: %v", err)
	}
}

func TestMeasureFsyncLatencyRejectsShortWrite(t *testing.T) {
	_, err := measureFsyncLatency(
		context.Background(),
		fakeFsyncFile{short: true},
		make([]byte, diskAlign),
		2,
	)
	if !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("short write error not propagated: %v", err)
	}
}

func TestMeasureFsyncLatencyRejectsNoSamples(t *testing.T) {
	if _, err := measureFsyncLatency(
		context.Background(),
		fakeFsyncFile{},
		make([]byte, diskAlign),
		0,
	); err == nil {
		t.Fatal("zero fsync iterations accepted")
	}
}

func TestMeasureRandomReadIOPSPropagatesWorkerError(t *testing.T) {
	_, err := measureRandomReadIOPS(
		context.Background(),
		fakeReaderAt{err: errors.New("read failed")},
		64,
		20*time.Millisecond,
		4,
	)
	if err == nil || !strings.Contains(err.Error(), "read failed") {
		t.Fatalf("random-read error not propagated: %v", err)
	}
}

func TestMeasureRandomReadIOPSRejectsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := measureRandomReadIOPS(
		ctx,
		fakeReaderAt{},
		64,
		20*time.Millisecond,
		4,
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}

func TestMeasureRandomReadIOPSRejectsShortRead(t *testing.T) {
	_, err := measureRandomReadIOPS(
		context.Background(),
		fakeReaderAt{short: true},
		64,
		20*time.Millisecond,
		4,
	)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("short random read error not propagated: %v", err)
	}
}

func TestMeasureRandomReadIOPSProducesSamples(t *testing.T) {
	iops, err := measureRandomReadIOPS(
		context.Background(),
		fakeReaderAt{},
		64,
		20*time.Millisecond,
		4,
	)
	if err != nil {
		t.Fatal(err)
	}
	if iops <= 0 {
		t.Fatalf("iops = %f, want positive value", iops)
	}
}
