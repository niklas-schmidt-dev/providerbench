//go:build !linux

package platform

import (
	"context"
	"errors"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

const spawnNeedsLinux = "it starts a static Linux executable"

func (spawnTest) Unavailable() string { return spawnNeedsLinux }

func (spawnTest) Run(context.Context, Options) (*bench.Result, error) {
	return nil, errors.New("spawn: " + spawnNeedsLinux)
}
