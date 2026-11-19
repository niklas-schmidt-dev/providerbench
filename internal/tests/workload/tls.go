package workload

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"math/big"
	"net"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(tlsTest{}) }

// tlsTest completes full TLS 1.3 handshakes — the asymmetric cryptography a
// server pays for every new connection.
type tlsTest struct{}

func (tlsTest) Name() string     { return "tls" }
func (tlsTest) Category() string { return Category }
func (tlsTest) Description() string {
	return "Full TLS 1.3 handshakes (X25519, ECDSA P-256), one core and all cores"
}

const tlsServerName = "providerbench.test"

// tlsConfigs returns a matching server and client configuration around a
// fresh self-signed certificate. Session tickets are off and the client keeps
// no session cache, so every handshake is a full one.
func tlsConfigs() (server, client *tls.Config, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: tlsServerName},
		DNSNames:              []string{tlsServerName},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, nil, err
	}
	roots := x509.NewCertPool()
	roots.AddCert(leaf)
	curves := []tls.CurveID{tls.X25519}
	server = &tls.Config{
		Certificates:           []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}},
		MinVersion:             tls.VersionTLS13,
		CurvePreferences:       curves,
		SessionTicketsDisabled: true,
	}
	client = &tls.Config{
		RootCAs:          roots,
		ServerName:       tlsServerName,
		MinVersion:       tls.VersionTLS13,
		CurvePreferences: curves,
	}
	return server, client, nil
}

// handshake runs one full handshake between an in-memory client and server.
// The pipe has no kernel in the path: the time is the cryptography.
func handshake(server, client *tls.Config) error {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()
	deadline := time.Now().Add(10 * time.Second)
	clientConn.SetDeadline(deadline)
	serverConn.SetDeadline(deadline)

	serverErr := make(chan error, 1)
	tlsServer := tls.Server(serverConn, server)
	go func() { serverErr <- tlsServer.Handshake() }()

	tlsClient := tls.Client(clientConn, client)
	if err := tlsClient.Handshake(); err != nil {
		return fmt.Errorf("client: %w", err)
	}
	if err := <-serverErr; err != nil {
		return fmt.Errorf("server: %w", err)
	}
	state := tlsClient.ConnectionState()
	if state.Version != tls.VersionTLS13 || state.DidResume {
		return errors.New("handshake was not a full TLS 1.3 handshake")
	}
	return nil
}

func (tlsTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("tls")
	server, client, err := tlsConfigs()
	if err != nil {
		return nil, fmt.Errorf("tls: create certificate: %w", err)
	}

	newWork := func() func() (int64, error) {
		return func() (int64, error) {
			if err := handshake(server, client); err != nil {
				return 0, err
			}
			return 1, nil
		}
	}

	if err := scaled(ctx, opts, res, "handshakes/s", 1, newWork); err != nil {
		return nil, fmt.Errorf("tls: %w", err)
	}
	res.Note("client and server both run on this machine over an in-memory pipe; no session resumption")
	res.Finish()
	return res, ctx.Err()
}
