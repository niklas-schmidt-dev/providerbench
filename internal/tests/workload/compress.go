package workload

import (
	"bytes"
	"compress/flate"
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(compressTest{}) }

// compressTest round-trips text through DEFLATE, the codec behind gzip, zip
// and HTTP compression.
type compressTest struct{}

func (compressTest) Name() string     { return "compress" }
func (compressTest) Category() string { return Category }
func (compressTest) Description() string {
	return "DEFLATE compress + decompress round trip over text, one core and all cores"
}

const compressChunk = 512 << 10

func (compressTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("compress")
	input := textCorpus(compressChunk)

	newWork := func() func() (int64, error) {
		var packed bytes.Buffer
		unpacked := make([]byte, 0, len(input))
		writer, err := flate.NewWriter(&packed, flate.DefaultCompression)
		reader := flate.NewReader(bytes.NewReader(nil))
		verified := false
		return func() (int64, error) {
			if err != nil {
				return 0, err
			}
			packed.Reset()
			writer.Reset(&packed)
			if _, err := writer.Write(input); err != nil {
				return 0, err
			}
			if err := writer.Close(); err != nil {
				return 0, err
			}
			if err := reader.(flate.Resetter).Reset(bytes.NewReader(packed.Bytes()), nil); err != nil {
				return 0, err
			}
			out := bytes.NewBuffer(unpacked[:0])
			if _, err := io.Copy(out, reader); err != nil {
				return 0, err
			}
			if out.Len() != len(input) {
				return 0, fmt.Errorf("round trip returned %d bytes, want %d", out.Len(), len(input))
			}
			if !verified {
				if !bytes.Equal(out.Bytes(), input) {
					return 0, errors.New("round trip returned different bytes")
				}
				verified = true
			}
			return int64(len(input)), nil
		}
	}

	if err := scaled(ctx, opts, res, "MB/s", 1e-6, newWork); err != nil {
		return nil, fmt.Errorf("compress: %w", err)
	}
	res.Note("DEFLATE level 6 over %d KiB of text; throughput counts uncompressed bytes through compress and decompress", compressChunk>>10)
	res.Finish()
	return res, ctx.Err()
}
