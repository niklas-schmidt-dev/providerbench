package storage

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// The signer must reproduce the worked example from the AWS SigV4
// documentation (GET Object, 2013-05-24, us-east-1) byte for byte.
func TestSignerMatchesAWSDocExample(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=0-9")
	sig := signer{
		accessKey: "AKIAIOSFODNN7EXAMPLE",
		secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		region:    "us-east-1",
	}
	sig.sign(req, emptyPayloadHash, time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))

	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("authorization mismatch\n got: %s\nwant: %s", got, want)
	}
}

func TestCanonicalQuerySortsAndEncodes(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "https://h.example/?prefix=a%2Fb+c&list-type=2", nil)
	got := canonicalQuery(req.URL.Query())
	want := "list-type=2&prefix=a%2Fb%20c"
	if got != want {
		t.Fatalf("canonical query = %q, want %q", got, want)
	}
}

// fakeS3 is an in-memory S3 endpoint: enough of the API for the benchmark,
// strict about the request shapes it accepts.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
	badAuth []string
}

func newFakeS3() *fakeS3 { return &fakeS3{objects: map[string][]byte{}} }

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=test-access/") ||
		!strings.Contains(auth, "/s3/aws4_request") ||
		!strings.Contains(auth, "SignedHeaders=") ||
		!strings.Contains(auth, "Signature=") ||
		r.Header.Get("x-amz-date") == "" ||
		r.Header.Get("x-amz-content-sha256") == "" {
		f.badAuth = append(f.badAuth, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, "<Error><Code>SignatureDoesNotMatch</Code></Error>")
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/test-bucket")
	key := strings.TrimPrefix(path, "/")

	switch {
	case r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2":
		type entry struct {
			Key string `xml:"Key"`
		}
		var contents []entry
		prefix := r.URL.Query().Get("prefix")
		for k := range f.objects {
			if strings.HasPrefix(k, prefix) {
				contents = append(contents, entry{Key: k})
			}
		}
		out, _ := xml.Marshal(struct {
			XMLName  xml.Name `xml:"ListBucketResult"`
			Contents []entry  `xml:"Contents"`
		}{Contents: contents})
		w.Write(out)
	case r.Method == http.MethodPut:
		body, _ := io.ReadAll(r.Body)
		f.objects[key] = body
	case r.Method == http.MethodGet:
		body, ok := f.objects[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, "<Error><Code>NoSuchKey</Code></Error>")
			return
		}
		w.Write(body)
	case r.Method == http.MethodDelete:
		delete(f.objects, key)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func setEnv(t *testing.T, endpoint string) {
	t.Setenv("PB_S3_ENDPOINT", endpoint)
	t.Setenv("PB_S3_BUCKET", "test-bucket")
	t.Setenv("PB_S3_ACCESS_KEY", "test-access")
	t.Setenv("PB_S3_SECRET_KEY", "test-secret")
	t.Setenv("PB_S3_REGION", "auto")
	t.Setenv("PB_S3_PREFIX", "bench")
	t.Setenv("PB_S3_PATH_STYLE", "")
}

func TestS3RunAgainstFakeEndpoint(t *testing.T) {
	fake := newFakeS3()
	server := httptest.NewServer(fake)
	defer server.Close()
	setEnv(t, server.URL)

	res, err := s3Test{}.Run(context.Background(), Options{Quick: true})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(fake.badAuth) > 0 {
		t.Fatalf("requests with malformed SigV4 authorization: %v", fake.badAuth)
	}

	want := []string{
		"ttfb_p50", "small_put_p50", "small_put_p99", "small_get_p50",
		"small_get_p99", "list_p50", "upload_throughput", "download_throughput",
	}
	got := map[string]float64{}
	for _, m := range res.Metrics {
		got[m.Name] = m.Value
	}
	for _, name := range want {
		value, ok := got[name]
		if !ok {
			t.Errorf("metric %s missing", name)
			continue
		}
		if value < 0 {
			t.Errorf("metric %s = %v, want >= 0", name, value)
		}
	}
	if len(got) != len(want) {
		t.Errorf("got %d metrics, want %d: %v", len(got), len(want), res.Metrics)
	}

	// Cleanup must leave nothing behind — the run may only ever touch its own
	// unique key prefix.
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.objects) != 0 {
		keys := make([]string, 0, len(fake.objects))
		for k := range fake.objects {
			keys = append(keys, k)
		}
		t.Errorf("objects left after cleanup: %v", keys)
	}
}

func TestS3RunReportsHelpfulConfigError(t *testing.T) {
	t.Setenv("PB_S3_ENDPOINT", "")
	t.Setenv("PB_S3_BUCKET", "")
	t.Setenv("PB_S3_ACCESS_KEY", "")
	t.Setenv("PB_S3_SECRET_KEY", "")
	_, err := s3Test{}.Run(context.Background(), Options{Quick: true})
	if err == nil || !strings.Contains(err.Error(), "PB_S3_ENDPOINT") {
		t.Fatalf("want config error naming PB_S3_ENDPOINT, got %v", err)
	}
}

func TestS3RunSurfacesAccessErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, "<Error><Code>AccessDenied</Code></Error>")
	}))
	defer server.Close()
	setEnv(t, server.URL)

	_, err := s3Test{}.Run(context.Background(), Options{Quick: true})
	if err == nil || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("want AccessDenied error, got %v", err)
	}
}

func TestS3IdentityAndCategory(t *testing.T) {
	test := s3Test{}
	if test.Name() != "s3" {
		t.Errorf("name = %q", test.Name())
	}
	if test.Category() != "storage" {
		t.Errorf("category = %q", test.Category())
	}
	if test.Description() == "" {
		t.Error("description is empty")
	}
	_ = fmt.Sprintf("%v", test) // the type must stay printable for `list`
}
