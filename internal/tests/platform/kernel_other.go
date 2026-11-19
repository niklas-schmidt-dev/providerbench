//go:build !linux && !darwin

package platform

import (
	"context"
	"errors"
	"time"
)

const kernelProbes = false

var errUnsupported = errors.New("not implemented on this platform")

func syscallCost(context.Context, time.Duration) float64 { return 0 }

func pipeRoundTrip(context.Context, time.Duration) (float64, error) { return 0, errUnsupported }

func firstTouch(context.Context, time.Duration, int) (float64, int, error) {
	return 0, 0, errUnsupported
}
