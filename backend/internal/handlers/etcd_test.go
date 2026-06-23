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
		DefaultClient: cli,
		Prefix:        "/",
		ClientManager: NewClientManager(),
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

	req, _ := http.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	// Manually set the etcd client in context
	c.Set("etcdClient", cli)

	h.HealthCheck(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
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

	req, _ := http.NewRequest("GET", "/api/keys?prefix="+testKey, nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	// Manually set the etcd client in context
	c.Set("etcdClient", cli)

	h.GetKeys(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestCreateAndDeleteKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	testKey := "/test-create-key-" + time.Now().Format("20060102150405")

	// Test CreateKey
	body := `{"key":"` + testKey + `","value":"test-value"}`
	req, _ := http.NewRequest("POST", "/api/keys", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	// Manually set the etcd client in context
	c.Set("etcdClient", cli)

	h.CreateKey(c)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", w.Code)
	}

	ctx := context.Background()
	resp, _ := cli.Get(ctx, testKey)
	if resp.Count != 1 {
		t.Error("Key was not created in etcd")
	}

	// Test DeleteKey
	req2, _ := http.NewRequest("DELETE", "/api/keys?key="+testKey, nil)
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = req2

	// Manually set the etcd client in context
	c2.Set("etcdClient", cli)

	h.DeleteKey(c2)

	if w2.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w2.Code)
	}

	resp, _ = cli.Get(ctx, testKey)
	if resp.Count != 0 {
		t.Error("Key was not deleted from etcd")
	}
}

func TestExtractKeyChildren(t *testing.T) {
	children := extractKeyChildren("/", []string{
		"/app/config",
		"/app/db/host",
		"/user",
	})
	if len(children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(children))
	}

	childMap := make(map[string]KeyChild)
	for _, child := range children {
		childMap[child.Name] = child
	}

	if childMap["app"].Path != "/app" || childMap["app"].IsLeaf {
		t.Errorf("unexpected app child: %+v", childMap["app"])
	}
	if childMap["user"].Path != "/user" || !childMap["user"].IsLeaf {
		t.Errorf("unexpected user child: %+v", childMap["user"])
	}
}

func TestGetKeyChildren(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	testKey := "/test-children-" + time.Now().Format("20060102150405")
	ctx := context.Background()
	cli.Put(ctx, testKey+"/app/config", "value1")
	cli.Put(ctx, testKey+"/user", "value2")
	defer cleanupKey(t, cli, testKey)

	req, _ := http.NewRequest("GET", "/api/keys/children?prefix="+testKey, nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set("etcdClient", cli)

	h.GetKeyChildren(c)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}
}

func TestGetKeyViaGetKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, cli := setupTestHandler(t)
	defer cli.Close()

	testKey := "/test-get-key-" + time.Now().Format("20060102150405")
	ctx := context.Background()
	cli.Put(ctx, testKey, "detail-value")
	defer cleanupKey(t, cli, testKey)

	req, _ := http.NewRequest("GET", "/api/keys?key="+testKey, nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set("etcdClient", cli)

	h.GetKeys(c)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "detail-value") {
		t.Fatalf("Expected key value in response, got %s", w.Body.String())
	}
}
