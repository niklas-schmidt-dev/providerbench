package workload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"reflect"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(jsonTest{}) }

// jsonTest encodes and decodes API-shaped records — the serialization work
// of nearly every web backend.
type jsonTest struct{}

func (jsonTest) Name() string     { return "json" }
func (jsonTest) Category() string { return Category }
func (jsonTest) Description() string {
	return "JSON encode + decode of API-shaped records, one core and all cores"
}

type jsonGeo struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	City string  `json:"city"`
}

type jsonRecord struct {
	ID      uint64            `json:"id"`
	Name    string            `json:"name"`
	Email   string            `json:"email"`
	Active  bool              `json:"active"`
	Score   float64           `json:"score"`
	Visits  int               `json:"visits"`
	Tags    []string          `json:"tags"`
	Attrs   map[string]string `json:"attrs"`
	Geo     jsonGeo           `json:"geo"`
	Comment string            `json:"comment"`
}

const jsonRecords = 1000

// jsonDocument builds the fixed record set from a fixed seed.
func jsonDocument() []jsonRecord {
	rng := rand.New(rand.NewSource(7))
	vocab := vocabulary(rng, 512)
	word := func() string { return string(vocab[rng.Intn(len(vocab))]) }
	phrase := func(words int) string {
		out := word()
		for i := 1; i < words; i++ {
			out += " " + word()
		}
		return out
	}
	records := make([]jsonRecord, jsonRecords)
	for i := range records {
		tags := make([]string, 1+rng.Intn(5))
		for j := range tags {
			tags[j] = word()
		}
		attrs := make(map[string]string, 4)
		for len(attrs) < 4 {
			attrs[word()] = phrase(2)
		}
		records[i] = jsonRecord{
			ID:      rng.Uint64(),
			Name:    phrase(2),
			Email:   word() + "@" + word() + ".example",
			Active:  rng.Intn(2) == 0,
			Score:   float64(rng.Intn(1<<20)) / 1024,
			Visits:  rng.Intn(100000),
			Tags:    tags,
			Attrs:   attrs,
			Geo:     jsonGeo{Lat: float64(rng.Intn(180<<8))/256 - 90, Lon: float64(rng.Intn(360<<8))/256 - 180, City: word()},
			Comment: phrase(6 + rng.Intn(20)),
		}
	}
	return records
}

func (jsonTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("json")
	document := jsonDocument()
	encoded, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("json: %w", err)
	}

	newWork := func() func() (int64, error) {
		verified := false
		return func() (int64, error) {
			data, err := json.Marshal(document)
			if err != nil {
				return 0, err
			}
			var decoded []jsonRecord
			if err := json.Unmarshal(data, &decoded); err != nil {
				return 0, err
			}
			if len(decoded) != len(document) {
				return 0, fmt.Errorf("decoded %d records, want %d", len(decoded), len(document))
			}
			if !verified {
				if !reflect.DeepEqual(decoded, document) {
					return 0, errors.New("round trip changed the records")
				}
				verified = true
			}
			return int64(len(data)), nil
		}
	}

	if err := scaled(ctx, opts, res, "MB/s", 1e-6, newWork); err != nil {
		return nil, fmt.Errorf("json: %w", err)
	}
	res.Note("%d records, %d KiB of JSON per round trip; throughput counts JSON bytes through encode and decode", jsonRecords, len(encoded)>>10)
	res.Finish()
	return res, ctx.Err()
}
