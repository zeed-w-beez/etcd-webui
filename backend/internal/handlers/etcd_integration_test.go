package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	clientv3 "go.etcd.io/etcd/client/v3"
)

func setupIntegrationTestHandler(t *testing.T) (*Handler, *clientv3.Client) {
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{"localhost:2379"},
		DialTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Skip("etcd not available, skipping test")
	}

	h := &Handler{
		Client: cli,
		Prefix: "",
	}

	return h, cli
}

func TestUpdateKeyIntegration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupIntegrationTestHandler(t)
	defer cli.Close()

	testKey := "/test-update-key-" + time.Now().Format("20060102150405")

	ctx := context.Background()
	_, err := cli.Put(ctx, testKey, "original-value")
	if err != nil {
		t.Fatalf("Failed to setup test key: %v", err)
	}

	router := gin.New()
	router.PUT("/api/keys/*key", h.UpdateKey)

	body := `{"value":"updated-value"}`
	req, _ := http.NewRequest("PUT", "/api/keys"+testKey, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	resp, err := cli.Get(ctx, testKey)
	if err != nil {
		t.Fatalf("Failed to get key: %v", err)
	}
	if resp.Count != 1 {
		t.Fatalf("Expected 1 key, got %d", resp.Count)
	}
	if string(resp.Kvs[0].Value) != "updated-value" {
		t.Errorf("Expected value 'updated-value', got '%s'", string(resp.Kvs[0].Value))
	}

	cli.Delete(ctx, testKey)
}

func TestDeleteKeyIntegration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupIntegrationTestHandler(t)
	defer cli.Close()

	testKey := "/test-delete-key-" + time.Now().Format("20060102150405")

	ctx := context.Background()
	_, err := cli.Put(ctx, testKey, "test-value")
	if err != nil {
		t.Fatalf("Failed to setup test key: %v", err)
	}

	router := gin.New()
	router.DELETE("/api/keys/*key", h.DeleteKey)

	req, _ := http.NewRequest("DELETE", "/api/keys"+testKey, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	resp, err := cli.Get(ctx, testKey)
	if err != nil {
		t.Fatalf("Failed to get key: %v", err)
	}
	if resp.Count != 0 {
		t.Errorf("Expected 0 keys after delete, got %d", resp.Count)
	}
}

func TestUpdateKeyWithEncodedSlashes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupIntegrationTestHandler(t)
	defer cli.Close()

	testKey := "/nested/path/key-" + time.Now().Format("20060102150405")

	ctx := context.Background()
	_, err := cli.Put(ctx, testKey, "original")
	if err != nil {
		t.Fatalf("Failed to setup test key: %v", err)
	}

	router := gin.New()
	router.PUT("/api/keys/*key", h.UpdateKey)

	body := `{"value":"updated"}`
	req, _ := http.NewRequest("PUT", "/api/keys"+testKey, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	resp, err := cli.Get(ctx, testKey)
	if err != nil {
		t.Fatalf("Failed to get key: %v", err)
	}
	if resp.Count != 1 || string(resp.Kvs[0].Value) != "updated" {
		t.Errorf("Update failed: count=%d, value='%s'", resp.Count, string(resp.Kvs[0].Value))
	}

	cli.Delete(ctx, testKey)
}

func TestKeyRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupIntegrationTestHandler(t)
	defer cli.Close()

	timestamp := time.Now().Format("20060102150405")
	testKey := "/test/roundtrip/" + timestamp

	ctx := context.Background()

	router := gin.New()
	router.POST("/api/keys", h.CreateKey)
	router.PUT("/api/keys/*key", h.UpdateKey)
	router.GET("/api/keys/*key", h.GetKey)
	router.DELETE("/api/keys/*key", h.DeleteKey)

	createBody := `{"key":"` + testKey + `","value":"v1"}`
	req, _ := http.NewRequest("POST", "/api/keys", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Create failed: %d %s", w.Code, w.Body.String())
	}

	req, _ = http.NewRequest("GET", "/api/keys"+testKey, nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Get failed: %d %s", w.Code, w.Body.String())
	}

	updateBody := `{"value":"v2"}`
	req, _ = http.NewRequest("PUT", "/api/keys"+testKey, strings.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Update failed: %d %s", w.Code, w.Body.String())
	}

	req, _ = http.NewRequest("DELETE", "/api/keys"+testKey, nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Delete failed: %d %s", w.Code, w.Body.String())
	}

	resp, _ := cli.Get(ctx, testKey)
	if resp.Count != 0 {
		t.Errorf("Key still exists after delete: count=%d", resp.Count)
	}
}
