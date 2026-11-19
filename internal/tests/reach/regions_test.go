package reach

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

type fakeResolver struct {
	ips []net.IP
	err error
}

func (f fakeResolver) LookupIP(context.Context, string, string) ([]net.IP, error) {
	return f.ips, f.err
}

// redirectDialer sends every connection to a local listener and records the
// address the test asked for.
type redirectDialer struct {
	target      string
	addresses   []string
	failAt      int
	unreachable map[string]bool
}

func (d *redirectDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	d.addresses = append(d.addresses, address)
	if d.failAt == len(d.addresses) || d.unreachable[address] {
		return nil, errors.New("connection refused")
	}
	var dialer net.Dialer
	return dialer.DialContext(ctx, "tcp", d.target)
}

func listen(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	return listener.Addr().String()
}

func TestMeasureRTTDiscardsTheFirstConnectAndPinsOneAddress(t *testing.T) {
	dial := &redirectDialer{target: listen(t)}
	lookup := fakeResolver{ips: []net.IP{net.ParseIP("192.0.2.10"), net.ParseIP("192.0.2.11")}}
	rtt, err := measureRTT(context.Background(), lookup, dial, "anchor.example", 5)
	if err != nil {
		t.Fatal(err)
	}
	if rtt <= 0 {
		t.Errorf("rtt = %v, want a positive duration", rtt)
	}
	if len(dial.addresses) != 6 {
		t.Fatalf("made %d connects, want 5 samples plus one discarded", len(dial.addresses))
	}
	for _, address := range dial.addresses {
		if address != "192.0.2.10:443" {
			t.Errorf("connected to %s; every sample must use the first resolved address on 443", address)
		}
	}
}

func TestMeasureRTTFallsBackToAReachableAddress(t *testing.T) {
	dial := &redirectDialer{target: listen(t), unreachable: map[string]bool{"192.0.2.10:443": true}}
	lookup := fakeResolver{ips: []net.IP{net.ParseIP("192.0.2.10"), net.ParseIP("192.0.2.11"), net.ParseIP("192.0.2.12")}}
	if _, err := measureRTT(context.Background(), lookup, dial, "anchor.example", 4); err != nil {
		t.Fatal(err)
	}
	want := []string{"192.0.2.10:443", "192.0.2.11:443", "192.0.2.11:443", "192.0.2.11:443", "192.0.2.11:443", "192.0.2.11:443"}
	if len(dial.addresses) != len(want) {
		t.Fatalf("connects = %v, want %v", dial.addresses, want)
	}
	for i := range want {
		if dial.addresses[i] != want[i] {
			t.Fatalf("connects = %v, want %v", dial.addresses, want)
		}
	}
}

func TestMeasureRTTGivesUpAfterAFewAddresses(t *testing.T) {
	dead := map[string]bool{}
	var ips []net.IP
	for i := range maxCandidates + 2 {
		ip := net.IPv4(192, 0, 2, byte(10+i))
		ips = append(ips, ip)
		dead[net.JoinHostPort(ip.String(), "443")] = true
	}
	dial := &redirectDialer{target: listen(t), unreachable: dead}
	if _, err := measureRTT(context.Background(), fakeResolver{ips: ips}, dial, "anchor.example", 4); err == nil {
		t.Fatal("an anchor with no reachable address must fail")
	}
	if len(dial.addresses) != maxCandidates {
		t.Fatalf("tried %d addresses, want at most %d", len(dial.addresses), maxCandidates)
	}
}

func TestMeasureRTTFailsRatherThanReportingAPartialSample(t *testing.T) {
	target := listen(t)
	lookup := fakeResolver{ips: []net.IP{net.ParseIP("192.0.2.10")}}
	if _, err := measureRTT(context.Background(), lookup, &redirectDialer{target: target, failAt: 3}, "anchor.example", 5); err == nil {
		t.Error("a failed connect must fail the anchor")
	}
	if _, err := measureRTT(context.Background(), fakeResolver{err: errors.New("nxdomain")}, &redirectDialer{target: target}, "anchor.example", 5); err == nil {
		t.Error("a failed lookup must fail the anchor")
	}
	if _, err := measureRTT(context.Background(), fakeResolver{}, &redirectDialer{target: target}, "anchor.example", 5); err == nil {
		t.Error("an anchor without an address must fail")
	}
}

// The anchor set defines the metrics. Changing it changes their meaning and
// needs a new protocol version.
func TestAnchorSetIsPinned(t *testing.T) {
	want := []string{
		"rtt_us_east_1", "rtt_us_west_2", "rtt_sa_east_1", "rtt_eu_west_1", "rtt_eu_central_1",
		"rtt_af_south_1", "rtt_ap_south_1", "rtt_ap_southeast_1", "rtt_ap_northeast_1",
	}
	if len(Anchors) != len(want) {
		t.Fatalf("anchor set has %d entries, want %d", len(Anchors), len(want))
	}
	for i, anchor := range Anchors {
		if got := metricName(anchor.Region); got != want[i] {
			t.Errorf("anchor %d reports %s, want %s", i, got, want[i])
		}
		if host := anchorHost(anchor.Region); !strings.HasSuffix(host, ".amazonaws.com") || !strings.Contains(host, anchor.Region) {
			t.Errorf("anchor host %s does not address region %s", host, anchor.Region)
		}
	}
}

func TestRegionsIdentity(t *testing.T) {
	var b bench.Benchmark = regionsTest{}
	if b.Name() != "regions" || bench.CategoryOf(b) != Category || bench.ProfileOf(b) != bench.StandardProfile {
		t.Errorf("regions test is registered as %s/%s/%s", b.Name(), bench.CategoryOf(b), bench.ProfileOf(b))
	}
}
