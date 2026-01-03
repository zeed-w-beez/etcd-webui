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

func setupTestHandler(t *testing.T) (*Handler, *clientv3.Client) {
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{"localhost:2379"},
		DialTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Skip("etcd not available, skipping test")
	}

	h := &Handler{
		Client: cli,
		Prefix: "/",
	}

	return h, cli
}

func cleanupKey(t *testing.T, cli *clientv3.Client, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cli.Delete(ctx, key, clientv3.WithPrefix())
}

func TestHealthCheck(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	w, _ := gin.CreateTestContext(httptest.NewRecorder())
	req, _ := http.NewRequest("GET", "/api/health", nil)
	w.Request = req

	h.HealthCheck(w)

	if w.Writer.Status() != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Writer.Status())
	}
}

func TestGetKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	testKey := "/test-keys-" + time.Now().Format("20060102150405")
	ctx := context.Background()
	cli.Put(ctx, testKey+"/key1", "value1")
	cli.Put(ctx, testKey+"/key2", "value2")
	defer cleanupKey(t, cli, testKey)

	w, _ := gin.CreateTestContext(httptest.NewRecorder())
	req, _ := http.NewRequest("GET", "/api/keys?prefix="+testKey, nil)
	w.Request = req

	h.GetKeys(w)

	if w.Writer.Status() != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Writer.Status())
	}
}

func TestCreateAndDeleteKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	testKey := "/test-create-key-" + time.Now().Format("20060102150405")

	w, _ := gin.CreateTestContext(httptest.NewRecorder())
	body := `{"key":"` + testKey + `","value":"test-value"}`
	req, _ := http.NewRequest("POST", "/api/keys", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w.Request = req

	h.CreateKey(w)

	if w.Writer.Status() != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", w.Writer.Status())
	}

	ctx := context.Background()
	resp, _ := cli.Get(ctx, testKey)
	if resp.Count != 1 {
		t.Error("Key was not created in etcd")
	}

	router := gin.New()
	router.DELETE("/api/keys/*key", h.DeleteKey)
	w2, _ := gin.CreateTestContext(httptest.NewRecorder())
	req2, _ := http.NewRequest("DELETE", "/api/keys"+testKey, nil)
	w2.Request = req2
	router.ServeHTTP(w2.Writer, w2.Request)

	if w2.Writer.Status() != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w2.Writer.Status())
	}

	resp, _ = cli.Get(ctx, testKey)
	if resp.Count != 0 {
		t.Error("Key was not deleted from etcd")
	}
}
