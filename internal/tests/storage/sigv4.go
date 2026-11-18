package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// AWS Signature Version 4 for S3-compatible endpoints, on the standard
// library only — the benchmark binary stays a single dependency-free static
// build. Only the subset S3 needs is implemented: header signing with a
// pre-computed (or unsigned) payload hash.

const (
	// unsignedPayload skips body hashing; every major S3 implementation
	// accepts it and it keeps hashing cost out of upload timings.
	unsignedPayload = "UNSIGNED-PAYLOAD"
	// emptyPayloadHash is sha256("") for bodyless requests.
	emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

type signer struct {
	accessKey string
	secretKey string
	region    string
}

// sign stamps x-amz-date and x-amz-content-sha256 onto req and sets the
// Authorization header. The signed header set is host plus every x-amz-*
// header plus range and content-type when present — exactly what the request
// sends, so strict implementations accept it.
func (s signer) sign(req *http.Request, payloadHash string, now time.Time) {
	amzDate := now.UTC().Format("20060102T150405Z")
	dateStamp := now.UTC().Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)

	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	canonical := map[string]string{"host": host}
	for name, values := range req.Header {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-amz-") || lower == "range" || lower == "content-type" {
			canonical[lower] = strings.TrimSpace(values[0])
		}
	}
	names := make([]string, 0, len(canonical))
	for name := range canonical {
		names = append(names, name)
	}
	sort.Strings(names)

	var headerLines, signedHeaders strings.Builder
	for i, name := range names {
		headerLines.WriteString(name + ":" + canonical[name] + "\n")
		if i > 0 {
			signedHeaders.WriteString(";")
		}
		signedHeaders.WriteString(name)
	}

	canonicalRequest := strings.Join([]string{
		req.Method,
		encodePath(req.URL.Path),
		canonicalQuery(req.URL.Query()),
		headerLines.String(),
		signedHeaders.String(),
		payloadHash,
	}, "\n")

	scope := dateStamp + "/" + s.region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hexSHA256([]byte(canonicalRequest)),
	}, "\n")

	key := hmacSHA256([]byte("AWS4"+s.secretKey), dateStamp)
	key = hmacSHA256(key, s.region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, stringToSign))

	req.Header.Set("Authorization",
		"AWS4-HMAC-SHA256 Credential="+s.accessKey+"/"+scope+
			", SignedHeaders="+signedHeaders.String()+
			", Signature="+signature)
}

// encodePath URI-encodes a request path per SigV4: RFC 3986 unreserved
// characters stay literal, "/" separates segments, everything else escapes.
func encodePath(path string) string {
	if path == "" {
		return "/"
	}
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = uriEncode(segment)
	}
	return strings.Join(segments, "/")
}

// canonicalQuery sorts parameters by key and percent-encodes keys and values.
func canonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, key := range keys {
		sorted := append([]string(nil), values[key]...)
		sort.Strings(sorted)
		for _, value := range sorted {
			if b.Len() > 0 {
				b.WriteString("&")
			}
			b.WriteString(uriEncode(key) + "=" + uriEncode(value))
		}
	}
	return b.String()
}

func uriEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '-', c == '.', c == '_', c == '~':
			b.WriteByte(c)
		default:
			b.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return b.String()
}

func hexSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, message string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(message))
	return mac.Sum(nil)
}
