// Package reach measures how far a machine is from the rest of the internet.
// The compute suite's network test talks to the nearest edge, which says how
// good the last hop is; this suite times the path to fixed anchors on every
// continent, which says where the machine actually sits on the network.
package reach

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

// Category is the report category every test in this package belongs to.
const Category = "reach"

// Options is an alias so test files read naturally.
type Options = bench.Options

func init() { bench.Register(regionsTest{}) }

// regionsTest times TCP connections to one fixed anchor per major cloud
// region. A TCP handshake is one network round trip with no application
// behind it, so the connect time is the round-trip time of the path.
type regionsTest struct{}

func (regionsTest) Name() string     { return "regions" }
func (regionsTest) Category() string { return Category }
func (regionsTest) Description() string {
	return "Round-trip time to fixed anchors in nine cloud regions on six continents (TCP connect)"
}

// Anchor is one measured destination. The set is part of the protocol:
// changing it changes what the metrics mean.
type Anchor struct {
	Region string // AWS region id; also names the metric
	Place  string
}

// Anchors are the regional S3 endpoints of the largest public cloud: always
// on, present in every region, answered from inside the region rather than
// from an edge network, and published under several addresses each.
var Anchors = []Anchor{
	{"us-east-1", "N. Virginia"},
	{"us-west-2", "Oregon"},
	{"sa-east-1", "São Paulo"},
	{"eu-west-1", "Ireland"},
	{"eu-central-1", "Frankfurt"},
	{"af-south-1", "Cape Town"},
	{"ap-south-1", "Mumbai"},
	{"ap-southeast-1", "Singapore"},
	{"ap-northeast-1", "Tokyo"},
}

const (
	connectSamples = 7
	connectTimeout = 5 * time.Second
	// maxCandidates bounds how many of an anchor's addresses are tried
	// before the anchor counts as unreachable.
	maxCandidates = 3
)

func anchorHost(region string) string {
	return "s3." + region + ".amazonaws.com"
}

func metricName(region string) string {
	return "rtt_" + strings.ReplaceAll(region, "-", "_")
}

type dialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

type resolver interface {
	LookupIP(ctx context.Context, network, host string) ([]net.IP, error)
}

// measureRTT resolves an anchor once, settles on one of its addresses, then
// times connects to that address only. Name resolution and the first
// connect, which may wait on a route or neighbour lookup, stay out of the
// samples.
//
// An anchor publishes several addresses, and a network can fail to reach one
// of them while the region is fine. The untimed first connect therefore walks
// the addresses until one answers; only an anchor with no reachable address
// among the first few is unreachable.
func measureRTT(ctx context.Context, lookup resolver, dial dialer, host string, samples int) (float64, error) {
	ips, err := lookup.LookupIP(ctx, "ip4", host)
	if err != nil {
		return 0, fmt.Errorf("resolve %s: %w", host, err)
	}
	if len(ips) == 0 {
		return 0, fmt.Errorf("resolve %s: no IPv4 address", host)
	}
	address := ""
	for _, ip := range ips[:min(len(ips), maxCandidates)] {
		candidate := net.JoinHostPort(ip.String(), "443")
		conn, dialErr := dial.DialContext(ctx, "tcp4", candidate)
		if dialErr != nil {
			err = dialErr
			continue
		}
		conn.Close()
		address = candidate
		break
	}
	if address == "" {
		return 0, fmt.Errorf("connect to %s: %w", host, err)
	}
	times := make([]float64, 0, samples)
	for range samples {
		began := time.Now()
		conn, err := dial.DialContext(ctx, "tcp4", address)
		elapsed := time.Since(began)
		if err != nil {
			return 0, fmt.Errorf("connect to %s: %w", host, err)
		}
		conn.Close()
		times = append(times, kit.Ms(elapsed))
	}
	return kit.Median(times), nil
}

func (regionsTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("regions")
	samples := connectSamples
	if opts.Quick {
		samples = 3
	}
	dial := &net.Dialer{Timeout: connectTimeout}
	for _, anchor := range Anchors {
		opts.Logf("regions: %s (%s)...", anchor.Region, anchor.Place)
		rtt, err := measureRTT(ctx, net.DefaultResolver, dial, anchorHost(anchor.Region), samples)
		if err != nil {
			// One unreachable anchor fails the result: a partial matrix
			// would silently change what a cohort's medians cover.
			return nil, fmt.Errorf("regions: %w", err)
		}
		res.Add(metricName(anchor.Region), rtt, "ms", false)
	}
	if len(res.Metrics) == 0 {
		return nil, errors.New("regions: no anchor measured")
	}
	res.Note("median of %d TCP connects per anchor over IPv4; anchors are s3.<region>.amazonaws.com:443", samples)
	res.Note("connect time is one round trip plus the anchor's SYN handling; it does not include TLS or DNS")
	res.Finish()
	return res, ctx.Err()
}
