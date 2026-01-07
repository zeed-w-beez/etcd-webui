package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/zeed-w-beez/etcd-webui/backend/config"
	"github.com/zeed-w-beez/etcd-webui/backend/internal/logger"
	"go.etcd.io/etcd/api/v3/mvccpb"
	clientv3 "go.etcd.io/etcd/client/v3"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ClusterConfig represents the etcd cluster configuration from frontend
type ClusterConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Endpoint    string `json:"endpoint"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	TLS         bool   `json:"tls"`
	DialTimeout int    `json:"dialTimeout"`
}

// ClientManager manages etcd clients for different clusters
type ClientManager struct {
	clients map[string]*clientv3.Client
	configs map[string]*ClusterConfig
	mutex   sync.RWMutex
}

// NewClientManager creates a new client manager
func NewClientManager() *ClientManager {
	return &ClientManager{
		clients: make(map[string]*clientv3.Client),
		configs: make(map[string]*ClusterConfig),
	}
}

// normalizeEndpoint normalizes the etcd endpoint format
// etcd clientv3 expects format: "host:port" (without protocol prefix)
func normalizeEndpoint(endpoint string) string {
	if endpoint == "" {
		return endpoint
	}

	originalEndpoint := endpoint

	// Try to parse as URL first (handles http://, https://, and paths)
	if parsedURL, err := url.Parse(endpoint); err == nil && parsedURL.Host != "" {
		result := parsedURL.Host
		logger.Debug("Parsed endpoint %s -> %s (scheme: %s)", originalEndpoint, result, parsedURL.Scheme)
		return result
	}

	// If parsing failed, try adding http:// prefix and parse again
	if parsedURL, err := url.Parse("http://" + endpoint); err == nil && parsedURL.Host != "" {
		result := parsedURL.Host
		logger.Debug("Parsed endpoint %s -> %s (added http://)", originalEndpoint, result)
		return result
	}

	// Remove http:// or https:// prefix if present (fallback)
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	if endpoint != originalEndpoint {
		logger.Debug("Trimmed protocol prefix from %s -> %s", originalEndpoint, endpoint)
	}

	// Validate format: should be "host:port"
	if !strings.Contains(endpoint, ":") {
		logger.Warn("Endpoint %s does not contain port, this may cause issues", endpoint)
	}

	// Additional validation: ensure endpoint doesn't contain invalid characters
	if strings.Contains(endpoint, "0.0.0.0") && !strings.Contains(originalEndpoint, "0.0.0.0") {
		logger.Warn("Endpoint %s was normalized to %s, but contains 0.0.0.0 which may cause connection issues", originalEndpoint, endpoint)
	}

	return endpoint
}

// extractIPFromEndpoint extracts IP address from an endpoint string
// Examples:
//   - "http://172.16.171.54:8379" -> "172.16.171.54"
//   - "172.16.171.54:8379" -> "172.16.171.54"
func extractIPFromEndpoint(endpoint string) string {
	normalized := normalizeEndpoint(endpoint)
	// Extract IP:port, then get IP part
	if idx := strings.Index(normalized, ":"); idx > 0 {
		return normalized[:idx]
	}
	return normalized
}

// replaceZeroIP replaces 0.0.0.0 in endpoint with the provided IP address
// Examples:
//   - "http://0.0.0.0:8379" + "172.16.171.54" -> "http://172.16.171.54:8379"
//   - "0.0.0.0:8379" + "172.16.171.54" -> "172.16.171.54:8379"
func replaceZeroIP(endpoint, newIP string) string {
	if !strings.Contains(endpoint, "0.0.0.0") {
		return endpoint
	}

	// Replace 0.0.0.0 with new IP
	result := strings.ReplaceAll(endpoint, "0.0.0.0", newIP)
	logger.Debug("Replaced 0.0.0.0 in endpoint %s with IP %s -> %s", endpoint, newIP, result)
	return result
}

// GetClient returns the etcd client for the given cluster ID, or creates a new one if it doesn't exist
func (cm *ClientManager) GetClient(clusterConfig *ClusterConfig) (*clientv3.Client, error) {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Normalize endpoint format first (remove http:// or https:// prefix)
	normalizedEndpoint := normalizeEndpoint(clusterConfig.Endpoint)
	if normalizedEndpoint != clusterConfig.Endpoint {
		logger.Info("Normalized endpoint from %s to %s", clusterConfig.Endpoint, normalizedEndpoint)
	}

	// Create a normalized config copy for comparison
	normalizedConfig := *clusterConfig
	normalizedConfig.Endpoint = normalizedEndpoint

	// Check if client already exists for this cluster
	if client, exists := cm.clients[clusterConfig.ID]; exists {
		// Check if configuration has changed (compare normalized endpoints)
		if cfg, exists := cm.configs[clusterConfig.ID]; exists {
			normalizedCfgEndpoint := normalizeEndpoint(cfg.Endpoint)
			if normalizedCfgEndpoint == normalizedEndpoint &&
				cfg.Username == clusterConfig.Username &&
				cfg.Password == clusterConfig.Password &&
				cfg.DialTimeout == clusterConfig.DialTimeout {
				logger.Debug("Reusing existing etcd client for cluster %s (endpoint: %s)", clusterConfig.ID, normalizedEndpoint)
				return client, nil
			}
			logger.Info("Configuration changed for cluster %s, closing old client", clusterConfig.ID)
		}
		// Close old client if configuration has changed
		client.Close()
		delete(cm.clients, clusterConfig.ID)
		delete(cm.configs, clusterConfig.ID)
	}

	// Set default dial timeout if not provided
	// Frontend sends timeout in milliseconds, convert to seconds
	dialTimeoutSeconds := 5 // Default 5 seconds
	if clusterConfig.DialTimeout > 0 {
		// Convert milliseconds to seconds (frontend sends ms, backend expects seconds)
		if clusterConfig.DialTimeout > 1000 {
			// If value is > 1000, assume it's in milliseconds
			dialTimeoutSeconds = clusterConfig.DialTimeout / 1000
		} else {
			// If value is <= 1000, assume it's already in seconds
			dialTimeoutSeconds = clusterConfig.DialTimeout
		}
	}

	// Create new client
	logger.Info("Creating new etcd client for cluster %s (endpoint: %s, timeout: %ds)", clusterConfig.ID, normalizedEndpoint, dialTimeoutSeconds)
	clientConfig := clientv3.Config{
		Endpoints:   []string{normalizedEndpoint},
		DialTimeout: time.Duration(dialTimeoutSeconds) * time.Second,
		// Disable AutoSync to prevent client from using advertised addresses from server
		// This ensures we always use the endpoint we specify
		AutoSyncInterval: 0,
	}

	// Add authentication if provided
	if clusterConfig.Username != "" && clusterConfig.Password != "" {
		clientConfig.Username = clusterConfig.Username
		clientConfig.Password = clusterConfig.Password
		logger.Debug("Using authentication for cluster %s", clusterConfig.ID)
	}

	cli, err := clientv3.New(clientConfig)
	if err != nil {
		logger.Error("Failed to create etcd client for cluster %s (endpoint: %s): %v", clusterConfig.ID, normalizedEndpoint, err)
		return nil, fmt.Errorf("failed to create etcd client: %w", err)
	}

	// Verify the client endpoints are set correctly
	actualEndpoints := cli.Endpoints()
	if len(actualEndpoints) > 0 {
		logger.Debug("Etcd client created with endpoints: %v", actualEndpoints)
		if actualEndpoints[0] != normalizedEndpoint {
			logger.Warn("Endpoint mismatch: expected %s, got %s", normalizedEndpoint, actualEndpoints[0])
		}
		// Validate endpoint doesn't contain 0.0.0.0
		for _, ep := range actualEndpoints {
			if strings.Contains(ep, "0.0.0.0") && !strings.Contains(normalizedEndpoint, "0.0.0.0") {
				logger.Error("Endpoint was incorrectly resolved to %s (original: %s)", ep, normalizedEndpoint)
				cli.Close()
				return nil, fmt.Errorf("endpoint %s was incorrectly resolved to %s, check network configuration", normalizedEndpoint, ep)
			}
		}
	}

	// Test connection with a short timeout
	testCtx, testCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer testCancel()

	// Try to get status to verify connection
	_, testErr := cli.Status(testCtx, normalizedEndpoint)
	if testErr != nil {
		logger.Warn("Initial connection test failed for cluster %s (endpoint: %s): %v", clusterConfig.ID, normalizedEndpoint, testErr)
		logger.Info("Client created but connection test failed, this may be normal if etcd is starting up")
		// Don't fail here, as the client might work later (e.g., if etcd is still starting)
	} else {
		logger.Debug("Connection test successful for cluster %s (endpoint: %s)", clusterConfig.ID, normalizedEndpoint)
	}

	// Store client and normalized configuration
	cm.clients[clusterConfig.ID] = cli
	cm.configs[clusterConfig.ID] = &normalizedConfig

	logger.Info("Successfully created etcd client for cluster %s (endpoint: %s, actual endpoints: %v)", clusterConfig.ID, normalizedEndpoint, actualEndpoints)
	return cli, nil
}

// Close closes all clients
func (cm *ClientManager) Close() {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	for _, client := range cm.clients {
		client.Close()
	}

	cm.clients = make(map[string]*clientv3.Client)
	cm.configs = make(map[string]*ClusterConfig)
}

type Handler struct {
	ClientManager *ClientManager
	DefaultClient *clientv3.Client
	Prefix        string
	Config        *config.Config
}

type EtcdKey struct {
	Key            string `json:"key"`
	Value          string `json:"value"`
	Version        int64  `json:"version,omitempty"`
	ModRevision    int64  `json:"modRevision,omitempty"`
	CreateRevision int64  `json:"createRevision,omitempty"`
}

type HealthStatus struct {
	Status string `json:"status"`
	Etcd   string `json:"etcd"`
	Error  string `json:"error,omitempty"`
}

type KeysResponse struct {
	Keys []EtcdKey `json:"keys"`
}

type KeyResponse struct {
	Key            string `json:"key"`
	Value          string `json:"value"`
	Version        int64  `json:"version"`
	ModRevision    int64  `json:"modRevision"`
	CreateRevision int64  `json:"createRevision"`
}

type KeyHistoryResponse struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Revision int64  `json:"revision"`
	Version  int64  `json:"version"`
}

type CreateKeyRequest struct {
	Key   string `json:"key" binding:"required"`
	Value string `json:"value" binding:"required"`
}

type UpdateKeyRequest struct {
	Value string `json:"value" binding:"required"`
}

type DeleteKeysRequest struct {
	Keys []string `json:"keys"`
}

func NewHandler(client *clientv3.Client, clientManager *ClientManager, cfg *config.Config) *Handler {
	return &Handler{
		DefaultClient: client,
		ClientManager: clientManager,
		Prefix:        "",
		Config:        cfg,
	}
}

// ClusterMiddleware is a middleware that parses cluster configuration from request header
func (h *Handler) ClusterMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for X-Cluster-Config header
		clusterHeader := c.GetHeader("X-Cluster-Config")
		if clusterHeader == "" {
			// No cluster config provided, use default client
			c.Set("etcdClient", h.DefaultClient)
			c.Next()
			return
		}

		// Decode base64 encoded cluster config
		decoded, err := base64.StdEncoding.DecodeString(clusterHeader)
		if err != nil {
			logger.Error("Failed to decode cluster config: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cluster configuration"})
			c.Abort()
			return
		}

		// Parse JSON cluster config
		var clusterConfig ClusterConfig
		if err := json.Unmarshal(decoded, &clusterConfig); err != nil {
			logger.Error("Failed to parse cluster config: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cluster configuration format"})
			c.Abort()
			return
		}

		// Get or create etcd client for this cluster
		client, err := h.ClientManager.GetClient(&clusterConfig)
		if err != nil {
			logger.Error("Failed to get etcd client: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to connect to etcd cluster: %v", err)})
			c.Abort()
			return
		}

		// Store client and cluster config in context
		c.Set("etcdClient", client)
		c.Set("clusterConfig", &clusterConfig)
		c.Next()
	}
}

// GetClientFromContext returns the etcd client from the context
func (h *Handler) GetClientFromContext(c *gin.Context) (*clientv3.Client, error) {
	client, exists := c.Get("etcdClient")
	if !exists {
		return nil, fmt.Errorf("etcd client not found in context")
	}

	etcdClient, ok := client.(*clientv3.Client)
	if !ok {
		return nil, fmt.Errorf("invalid etcd client type")
	}

	return etcdClient, nil
}

func (h *Handler) Connect(cfg *config.Config) error {
	// 默认etcd端点设置
	etcdEndpoint := "localhost:2379"

	// 使用默认超时值5秒创建默认etcd客户端
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{etcdEndpoint},
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		return err
	}

	h.DefaultClient = cli
	return nil
}

func (h *Handler) HealthCheck(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	status := HealthStatus{
		Status: "unhealthy",
		Etcd:   "disconnected",
	}

	client, err := h.GetClientFromContext(c)
	if err != nil {
		status.Error = "etcd client not available"
		c.JSON(http.StatusServiceUnavailable, status)
		return
	}

	resp, err := client.Status(ctx, client.Endpoints()[0])
	if err != nil {
		status.Error = err.Error()
		c.JSON(http.StatusServiceUnavailable, status)
		return
	}

	status.Status = "healthy"
	status.Etcd = resp.Version
	c.JSON(http.StatusOK, status)
}

func (h *Handler) GetKeys(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	prefix := c.Query("prefix")
	limit := c.DefaultQuery("limit", "100")
	limitNum, _ := strconv.ParseInt(limit, 10, 64)

	if prefix == "" {
		prefix = "/"
	}

	opts := []clientv3.OpOption{
		clientv3.WithPrefix(),
	}

	resp, err := client.Get(ctx, prefix, append(opts, clientv3.WithLimit(limitNum))...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	keys := make([]EtcdKey, 0, resp.Count)
	for _, kv := range resp.Kvs {
		key := EtcdKey{
			Key:            string(kv.Key),
			Value:          string(kv.Value),
			Version:        kv.Version,
			ModRevision:    kv.ModRevision,
			CreateRevision: kv.CreateRevision,
		}
		keys = append(keys, key)
	}

	c.JSON(http.StatusOK, gin.H{
		"keys":  keys,
		"count": resp.Count,
	})
}

func (h *Handler) HandleKeys(c *gin.Context) {
	key := c.Param("key")
	// 添加前导斜杠，因为通配符路由不会包含它
	if key != "" && !strings.HasPrefix(key, "/") {
		key = "/" + key
	}

	path := c.Request.URL.Path
	method := c.Request.Method

	// 根据路径和方法决定处理逻辑
	if strings.HasSuffix(path, "/versions") {
		if method == "GET" {
			h.GetKeyVersions(c)
			return
		}
	} else if strings.HasSuffix(path, "/history") {
		if method == "GET" {
			h.GetKeyHistory(c)
			return
		}
	} else if key != "" && method == "GET" {
		h.GetKey(c)
		return
	} else if key != "" && method == "POST" {
		h.CreateKey(c)
		return
	} else if key != "" && method == "PUT" {
		h.UpdateKey(c)
		return
	} else if key != "" && method == "DELETE" {
		h.DeleteKey(c)
		return
	}

	// 如果没有匹配的处理程序，返回404
	c.JSON(http.StatusNotFound, gin.H{"error": "Endpoint not found"})
}

func (h *Handler) GetKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	// 优先从查询参数获取key
	key := c.Query("key")
	// 如果查询参数为空，尝试从路径参数获取
	if key == "" {
		key = c.Param("key")
		// 移除路径参数中的前缀斜杠（仅当从路径参数获取时）
		if strings.HasPrefix(key, "/") {
			key = key[1:]
		}
	}

	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	resp, err := client.Get(ctx, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if resp.Count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	kv := resp.Kvs[0]
	c.JSON(http.StatusOK, KeyResponse{
		Key:            string(kv.Key),
		Value:          string(kv.Value),
		Version:        kv.Version,
		ModRevision:    kv.ModRevision,
		CreateRevision: kv.CreateRevision,
	})
}

func (h *Handler) GetKeyHistory(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	revisionStr := c.Query("revision")
	var revision int64
	if revisionStr != "" {
		var err error
		revision, err = strconv.ParseInt(revisionStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid revision"})
			return
		}
	}

	resp, err := client.Get(ctx, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if resp.Count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found at specified revision"})
		return
	}

	var kv *mvccpb.KeyValue
	if revision > 0 {
		resp, err = client.Get(ctx, key, clientv3.WithRev(revision), clientv3.WithLimit(1))
		if err != nil {
			// Check if error is due to revision being compacted
			if st, ok := status.FromError(err); ok && st.Code() == codes.OutOfRange {
				logger.Warn("Revision %d for key %s has been compacted", revision, key)
				c.JSON(http.StatusBadRequest, gin.H{
					"error": fmt.Sprintf("Revision %d has been compacted and is no longer available", revision),
				})
				return
			}
			logger.Error("Error fetching key %s at revision %d: %v", key, revision, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		logger.Debug("Fetched key %s at revision %d: count=%d", key, revision, resp.Count)
		if resp.Count == 0 {
			logger.Debug("No data found for key %s at revision %d", key, revision)
			c.JSON(http.StatusNotFound, gin.H{"error": "key not found at specified revision"})
			return
		}
		kv = resp.Kvs[0]
		logger.Debug("Found value at revision %d: %s (ModRevision=%d)", kv.ModRevision, kv.Value, kv.ModRevision)
	} else {
		kv = resp.Kvs[0]
	}
	logger.Debug("Returning value for key %s: %s (revision %d, version %d)", key, kv.Value, kv.ModRevision, kv.Version)
	c.JSON(http.StatusOK, KeyHistoryResponse{
		Key:      string(kv.Key),
		Value:    string(kv.Value),
		Revision: kv.ModRevision,
		Version:  kv.Version,
	})
}

func (h *Handler) GetKeyVersions(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	resp, err := client.Get(ctx, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if resp.Count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	kv := resp.Kvs[0]
	currentVersion := int(kv.Version)
	currentModRev := kv.ModRevision

	versions := make([]map[string]int64, 0)
	versionsMap := make(map[int64]int64)

	if currentVersion <= 5 {
		startRev := currentModRev - int64(currentVersion*3)
		if startRev < 1 {
			startRev = 1
		}

		// Track if we've encountered a compacted revision
		compactedEncountered := false
		for rev := startRev; rev <= currentModRev; rev++ {
			histResp, err := client.Get(ctx, key, clientv3.WithRev(rev), clientv3.WithLimit(1))
			if err != nil {
				// Check if error is due to revision being compacted
				if st, ok := status.FromError(err); ok && st.Code() == codes.OutOfRange {
					compactedEncountered = true
					// Skip this revision and continue with next ones
					continue
				}
				// For other errors, log but continue
				logger.Debug("Error fetching key %s at revision %d: %v", key, rev, err)
				continue
			}
			if histResp.Count > 0 {
				histKv := histResp.Kvs[0]
				version := histKv.Version
				if existingRev, exists := versionsMap[version]; !exists || existingRev < histKv.ModRevision {
					versionsMap[version] = histKv.ModRevision
				}
			}
		}

		// If we encountered compacted revisions, log a warning
		if compactedEncountered {
			logger.Debug("Some revisions for key %s have been compacted, only available versions are returned", key)
		}

		for v := 1; v <= currentVersion; v++ {
			if rev, exists := versionsMap[int64(v)]; exists {
				versions = append(versions, map[string]int64{
					"version":  int64(v),
					"revision": rev,
				})
			}
		}
	}

	if len(versions) == 0 {
		versions = append(versions, map[string]int64{
			"version":  kv.Version,
			"revision": kv.ModRevision,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"key":            key,
		"currentVersion": currentVersion,
		"versions":       versions,
	})
}

func (h *Handler) CreateKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	var req CreateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err = client.Put(ctx, req.Key, req.Value)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, KeyResponse{
		Key:   req.Key,
		Value: req.Value,
	})
}

func (h *Handler) UpdateKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	// 优先从查询参数获取key
	key := c.Query("key")
	// 如果查询参数为空，尝试从路径参数获取
	if key == "" {
		key = c.Param("key")
		// 移除路径参数中的前缀斜杠（仅当从路径参数获取时）
		if strings.HasPrefix(key, "/") {
			key = key[1:]
		}
	}

	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	var req UpdateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err = client.Put(ctx, key, req.Value)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, KeyResponse{
		Key:   key,
		Value: req.Value,
	})
}

func (h *Handler) DeleteKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	// 优先从查询参数获取key
	key := c.Query("key")
	// 如果查询参数为空，尝试从路径参数获取
	if key == "" {
		key = c.Param("key")
		// 移除路径参数中的前缀斜杠（仅当从路径参数获取时）
		if strings.HasPrefix(key, "/") {
			key = key[1:]
		}
	}

	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	delOpts := []clientv3.OpOption{}
	if strings.HasSuffix(key, "/") || strings.Contains(key, "*") {
		delOpts = append(delOpts, clientv3.WithPrefix())
	}

	delResp, err := client.Delete(ctx, key, delOpts...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted": delResp.Deleted,
		"key":     key,
	})
}

func (h *Handler) DeleteKeys(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	var req DeleteKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	deleted := 0
	for _, key := range req.Keys {
		delResp, err := client.Delete(ctx, key)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "key": key})
			return
		}
		deleted += int(delResp.Deleted)
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted": deleted,
		"keys":    req.Keys,
	})
}

// ExportKeys exports all keys as JSON
func (h *Handler) ExportKeys(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	resp, err := client.Get(ctx, "", clientv3.WithPrefix())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	keys := make([]EtcdKey, 0, resp.Count)
	for _, kv := range resp.Kvs {
		keys = append(keys, EtcdKey{
			Key:   string(kv.Key),
			Value: string(kv.Value),
		})
	}

	c.Header("Content-Disposition", "attachment; filename=etcd-keys.json")
	c.Header("Content-Type", "application/json")
	c.JSON(http.StatusOK, keys)
}

// ImportKeys imports multiple keys at once
func (h *Handler) ImportKeys(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	var keys []EtcdKey
	if err := c.ShouldBindJSON(&keys); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Start a transaction to ensure atomicity
	txn := client.Txn(ctx)
	ops := make([]clientv3.Op, 0, len(keys))

	for _, kv := range keys {
		ops = append(ops, clientv3.OpPut(kv.Key, kv.Value))
	}

	resp, err := txn.Then(ops...).Commit()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !resp.Succeeded {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"imported": len(keys),
		"success":  true,
	})
}

// ClusterNode represents an etcd cluster node
type ClusterNode struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Endpoint         string `json:"endpoint"`
	Role             string `json:"role"` // leader or follower
	Version          string `json:"version"`
	DBSize           int64  `json:"dbSize"`
	IsLeader         bool   `json:"isLeader"`
	StartTime        string `json:"startTime"`
	DBUsedSize       int64  `json:"dbUsedSize"`
	APIRevision      int64  `json:"apiRevision"`
	StorageVersion   string `json:"storageVersion"`
	RaftIndex        uint64 `json:"raftIndex"`
	RaftTerm         uint64 `json:"raftTerm"`
	RaftAppliedIndex uint64 `json:"raftAppliedIndex"`
}

// WebSocket upgrader configuration
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

// WatchEvent represents an etcd watch event
type WatchEvent struct {
	Type     string `json:"type"` // "PUT" or "DELETE"
	Key      string `json:"key"`
	OldValue string `json:"oldValue,omitempty"`
	NewValue string `json:"newValue,omitempty"`
	Revision int64  `json:"revision"`
	LeaseID  int64  `json:"leaseID,omitempty"`
	Time     string `json:"time"`
}

// Watch handles WebSocket connections for etcd watch events
func (h *Handler) Watch(c *gin.Context) {
	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upgrade to WebSocket: %v", err)})
		return
	}
	defer conn.Close()

	// Get prefix from query parameter
	prefix := c.Query("prefix")

	// Get etcd client
	client, err := h.GetClientFromContext(c)
	if err != nil {
		conn.WriteJSON(gin.H{"error": "etcd client not available"})
		return
	}

	// Create context that cancels when the WebSocket connection closes
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	// Watch etcd for changes
	watchChan := client.Watch(ctx, prefix, clientv3.WithPrefix())

	// Send watch events to WebSocket client
	for watchResp := range watchChan {
		// Check for watch errors (e.g., revision compacted)
		if watchResp.Err() != nil {
			err := watchResp.Err()
			// Check if error is due to revision being compacted
			if st, ok := status.FromError(err); ok && st.Code() == codes.OutOfRange {
				logger.Warn("Watch error: revision has been compacted for prefix %s", prefix)
				conn.WriteJSON(gin.H{
					"error": "Watch failed: the requested revision has been compacted. Please reconnect.",
				})
				return
			}
			logger.Error("Watch error for prefix %s: %v", prefix, err)
			conn.WriteJSON(gin.H{"error": fmt.Sprintf("Watch error: %v", err)})
			return
		}

		for _, event := range watchResp.Events {
			// Create WatchEvent from etcd event
			watchEvent := WatchEvent{
				Key:      string(event.Kv.Key),
				Revision: event.Kv.ModRevision,
				LeaseID:  int64(event.Kv.Lease),
				Time:     time.Now().Format(time.RFC3339),
			}

			switch event.Type {
			case clientv3.EventTypePut:
				watchEvent.Type = "PUT"
				watchEvent.NewValue = string(event.Kv.Value)
				if event.PrevKv != nil && len(event.PrevKv.Value) > 0 {
					watchEvent.OldValue = string(event.PrevKv.Value)
				}
			case clientv3.EventTypeDelete:
				watchEvent.Type = "DELETE"
				if event.PrevKv != nil {
					watchEvent.OldValue = string(event.PrevKv.Value)
				}
			}

			// Send event to client
			if err := conn.WriteJSON(watchEvent); err != nil {
				logger.Debug("Failed to write watch event to WebSocket: %v", err)
				return
			}
		}
	}
}

// ClusterStatus represents the overall etcd cluster status
type ClusterStatus struct {
	Members          []ClusterNode   `json:"members"`
	Leader           uint64          `json:"leader"`
	LeaderID         string          `json:"leaderId"`
	Revision         int64           `json:"revision"`
	ClusterSize      int             `json:"clusterSize"`
	EtcdVersion      string          `json:"etcdVersion"`
	LeaderCount      int             `json:"leaderCount"`
	FollowerCount    int             `json:"followerCount"`
	TotalDBSize      int64           `json:"totalDbSize"`
	TotalKeys        int64           `json:"totalKeys"`
	RaftIndex        uint64          `json:"raftIndex"`
	RaftTerm         uint64          `json:"raftTerm"`
	RaftAppliedIndex uint64          `json:"raftAppliedIndex"`
	StorageVersion   string          `json:"storageVersion"`
	ClusterID        string          `json:"clusterId"`
	Features         ClusterFeatures `json:"features"`
}

type ClusterFeatures struct {
	CompactSupported   bool   `json:"compactSupported"`
	DefragSupported    bool   `json:"defragSupported"`
	MaxCompactRevision int64  `json:"maxCompactRevision"`
	MinDefragVersion   string `json:"minDefragVersion"`
}

// ClusterStatus represents the overall etcd cluster status
func (h *Handler) ClusterStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	// Get status of all members
	memberList, err := client.MemberList(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get current revision from a simple range query
	resp, err := client.Get(ctx, "\x00", clientv3.WithRange("\xFF"), clientv3.WithLimit(1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get leader info from status of endpoints
	var leaderID uint64
	var leaderNodeID string
	var nodes []ClusterNode
	var totalDBSize int64
	var etcdVersion string
	var raftIndex uint64
	var raftTerm uint64
	var raftAppliedIndex uint64

	// Get the configured endpoint and extract IP address
	configuredEndpoints := client.Endpoints()
	var configuredIP string
	var fallbackEndpoint string
	if len(configuredEndpoints) > 0 {
		fallbackEndpoint = configuredEndpoints[0]
		configuredIP = extractIPFromEndpoint(fallbackEndpoint)
		logger.Debug("Using configured endpoint: %s, extracted IP: %s", fallbackEndpoint, configuredIP)
	}

	// Use goroutines to fetch node status concurrently for better performance
	type nodeStatusResult struct {
		node    ClusterNode
		dbSize  int64
		leader  uint64
		version string
		raftIdx uint64
		raftTrm uint64
		raftApp uint64
		err     error
	}

	resultChan := make(chan nodeStatusResult, len(memberList.Members))

	for i := range memberList.Members {
		member := memberList.Members[i]
		go func(m *clientv3.Member) {
			// Try to get status for each endpoint
			for _, endpoint := range m.ClientURLs {
				// If endpoint contains 0.0.0.0, replace it with the configured IP address
				if strings.Contains(endpoint, "0.0.0.0") && configuredIP != "" {
					endpoint = replaceZeroIP(endpoint, configuredIP)
					logger.Debug("Replaced 0.0.0.0 in endpoint for member %d: %s", m.ID, endpoint)
				}

				// Normalize endpoint format
				normalizedEndpoint := normalizeEndpoint(endpoint)
				if normalizedEndpoint != endpoint {
					logger.Debug("Normalized member endpoint from %s to %s", endpoint, normalizedEndpoint)
				}

				status, err := client.Status(ctx, normalizedEndpoint)
				if err != nil {
					logger.Debug("Failed to get status for endpoint %s (member %d): %v", normalizedEndpoint, m.ID, err)
					continue
				}

				node := ClusterNode{
					ID:               fmt.Sprintf("%d", m.ID),
					Name:             m.Name,
					Endpoint:         normalizedEndpoint,
					Role:             "follower",
					Version:          status.Version,
					DBSize:           status.DbSize,
					IsLeader:         m.ID == status.Leader,
					StartTime:        time.Now().Format(time.RFC3339),
					RaftIndex:        status.RaftIndex,
					RaftTerm:         status.RaftTerm,
					RaftAppliedIndex: status.RaftAppliedIndex,
				}

				resultChan <- nodeStatusResult{
					node:    node,
					dbSize:  status.DbSize,
					leader:  status.Leader,
					version: status.Version,
					raftIdx: status.RaftIndex,
					raftTrm: status.RaftTerm,
					raftApp: status.RaftAppliedIndex,
					err:     nil,
				}
				logger.Debug("Successfully got status for endpoint %s (member %d)", normalizedEndpoint, m.ID)
				return // Only use the first working endpoint for each member
			}
			// If all endpoints failed, send an error result
			resultChan <- nodeStatusResult{err: fmt.Errorf("all endpoints failed for member %d", m.ID)}
		}(&clientv3.Member{
			ID:         member.ID,
			Name:       member.Name,
			PeerURLs:   member.PeerURLs,
			ClientURLs: member.ClientURLs,
		})
	}

	// Collect results from all goroutines
	for i := 0; i < len(memberList.Members); i++ {
		result := <-resultChan
		if result.err == nil {
			// Use the first successful result to set cluster-wide values
			if leaderID == 0 {
				leaderID = result.leader
				etcdVersion = result.version
				raftIndex = result.raftIdx
				raftTerm = result.raftTrm
				raftAppliedIndex = result.raftApp
			}

			// Update node role based on leader
			if result.node.IsLeader {
				result.node.Role = "leader"
				leaderNodeID = result.node.ID
			}

			nodes = append(nodes, result.node)
			totalDBSize += result.dbSize
		}
	}

	logger.Info("Collected %d nodes, version=%s, leaderID=%d", len(nodes), etcdVersion, leaderID)

	// Get total keys count using a proper range query (with shorter timeout to avoid blocking)
	var totalKeys int64
	keysCtx, keysCancel := context.WithTimeout(ctx, 3*time.Second)
	defer keysCancel()
	keysResp, err := client.Get(keysCtx, "\x00", clientv3.WithFromKey(), clientv3.WithCountOnly())
	if err == nil {
		totalKeys = int64(keysResp.Count)
	} else {
		logger.Debug("Failed to get total keys count: %v", err)
		// Continue without total keys count if it fails
	}

	// Ensure Members is always an array, never null
	if nodes == nil {
		nodes = []ClusterNode{}
	}

	c.JSON(http.StatusOK, ClusterStatus{
		Members:          nodes,
		Leader:           leaderID,
		LeaderID:         leaderNodeID,
		Revision:         resp.Header.Revision,
		ClusterSize:      len(nodes),
		EtcdVersion:      etcdVersion,
		LeaderCount:      1,
		FollowerCount:    len(nodes) - 1,
		TotalDBSize:      totalDBSize,
		TotalKeys:        totalKeys,
		RaftIndex:        raftIndex,
		RaftTerm:         raftTerm,
		RaftAppliedIndex: raftAppliedIndex,
		StorageVersion:   "v" + etcdVersion,
		ClusterID:        fmt.Sprintf("%x", memberList.Header.ClusterId),
		Features:         h.getClusterFeatures(etcdVersion),
	})
}

func (h *Handler) getClusterFeatures(version string) ClusterFeatures {
	major, minor, _, err := parseVersion(version)
	if err != nil {
		return ClusterFeatures{
			CompactSupported:   false,
			DefragSupported:    false,
			MaxCompactRevision: 0,
			MinDefragVersion:   "unknown",
		}
	}

	compactSupported := true
	defragSupported := major >= 3 && minor >= 3

	minDefragVersion := "3.3.0"
	if major < 3 || (major == 3 && minor < 3) {
		minDefragVersion = "not supported"
	}

	return ClusterFeatures{
		CompactSupported:   compactSupported,
		DefragSupported:    defragSupported,
		MaxCompactRevision: -1,
		MinDefragVersion:   minDefragVersion,
	}
}

func (h *Handler) Close() {
	if h.DefaultClient != nil {
		h.DefaultClient.Close()
	}
	// Close all clients in the client manager
	h.ClientManager.Close()
}

type CompactRequest struct {
	Revision int64 `json:"revision"`
}

type CompactResponse struct {
	Revision  int64  `json:"revision"`
	Compacted bool   `json:"compacted"`
	Message   string `json:"message"`
}

type DefragResponse struct {
	MemberEndpoint string `json:"memberEndpoint"`
	DBSize         int64  `json:"dbSize"`
	Success        bool   `json:"success"`
	Message        string `json:"message"`
}

type DefragStatusResponse struct {
	Version       string  `json:"version"`
	DBSize        int64   `json:"dbSize"`
	DBUsedSize    int64   `json:"dbUsedSize"`
	DefragNeeded  bool    `json:"defragNeeded"`
	DefragPercent float64 `json:"defragPercent"`
}

func parseVersion(version string) (major, minor, patch int, err error) {
	version = strings.TrimPrefix(version, "v")
	parts := strings.Split(version, ".")
	if len(parts) < 2 {
		return 0, 0, 0, fmt.Errorf("invalid version format: %s", version)
	}

	major, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, 0, err
	}

	minor, err = strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, 0, err
	}

	if len(parts) > 2 {
		patch, err = strconv.Atoi(parts[2])
		if err != nil {
			return 0, 0, 0, err
		}
	}

	return major, minor, patch, nil
}

func (h *Handler) Compact(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	var req CompactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Revision <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "revision must be greater than 0"})
		return
	}

	resp, err := client.Compact(ctx, req.Revision)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_ = resp

	c.JSON(http.StatusOK, CompactResponse{
		Revision:  req.Revision,
		Compacted: true,
		Message:   fmt.Sprintf("Successfully compacted etcd to revision %d", req.Revision),
	})
}

func (h *Handler) Defrag(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	memberList, err := client.MemberList(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var results []DefragResponse

	for _, member := range memberList.Members {
		for _, endpoint := range member.ClientURLs {
			status, err := client.Status(ctx, endpoint)
			if err != nil {
				continue
			}

			_, err = client.Defragment(ctx, endpoint)
			if err != nil {
				results = append(results, DefragResponse{
					MemberEndpoint: endpoint,
					DBSize:         status.DbSize,
					Success:        false,
					Message:        fmt.Sprintf("Failed to defragment: %v", err),
				})
			} else {
				results = append(results, DefragResponse{
					MemberEndpoint: endpoint,
					DBSize:         status.DbSize,
					Success:        true,
					Message:        fmt.Sprintf("Successfully defragmented %s", endpoint),
				})
			}
			break
		}
	}

	successCount := 0
	for _, r := range results {
		if r.Success {
			successCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"results":      results,
		"totalMembers": len(results),
		"successCount": successCount,
		"failedCount":  len(results) - successCount,
	})
}

// MetricsResponse represents the parsed metrics data
type MetricsResponse struct {
	ServerVersion string                 `json:"serverVersion"`
	ClusterID     string                 `json:"clusterId"`
	Members       []MemberMetrics        `json:"members"`
	Summary       MetricsSummary         `json:"summary"`
	RawMetrics    map[string]interface{} `json:"rawMetrics,omitempty"`
}

// MemberMetrics represents metrics for a single etcd member
type MemberMetrics struct {
	Endpoint           string `json:"endpoint"`
	IsLeader           bool   `json:"isLeader"`
	DBSize             int64  `json:"dbSize"`
	DBSizeInUse        int64  `json:"dbSizeInUse"`
	RaftIndex          uint64 `json:"raftIndex"`
	RaftTerm           uint64 `json:"raftTerm"`
	RaftAppliedIndex   uint64 `json:"raftAppliedIndex"`
	RaftCommittedIndex uint64 `json:"raftCommittedIndex"`
}

// MetricsSummary represents aggregated metrics
type MetricsSummary struct {
	TotalRequests    float64 `json:"totalRequests"`
	TotalKeys        int64   `json:"totalKeys"`
	TotalDBSize      int64   `json:"totalDbSize"`
	TotalDBSizeInUse int64   `json:"totalDbSizeInUse"`
	AverageLatency   float64 `json:"averageLatency"`
	LeaderCount      int     `json:"leaderCount"`
	FollowerCount    int     `json:"followerCount"`
	RaftProposals    float64 `json:"raftProposals"`
	RaftCommitted    float64 `json:"raftCommitted"`
	RaftApplied      float64 `json:"raftApplied"`
}

// GetClusterConfigFromContext returns the cluster config from the context
func (h *Handler) GetClusterConfigFromContext(c *gin.Context) (*ClusterConfig, error) {
	config, exists := c.Get("clusterConfig")
	if !exists {
		return nil, fmt.Errorf("cluster config not found in context")
	}

	clusterConfig, ok := config.(*ClusterConfig)
	if !ok {
		return nil, fmt.Errorf("invalid cluster config type")
	}

	return clusterConfig, nil
}

// GetMetrics fetches and parses etcd metrics
func (h *Handler) GetMetrics(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	client, err := h.GetClientFromContext(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "etcd client not available"})
		return
	}

	// Get cluster config to determine HTTP endpoint
	clusterConfig, err := h.GetClusterConfigFromContext(c)
	var metricsURL string
	if err == nil && clusterConfig != nil {
		// Use cluster config endpoint
		endpoint := normalizeEndpoint(clusterConfig.Endpoint)
		// Convert gRPC endpoint to HTTP endpoint (usually same host, different port or /metrics path)
		// etcd metrics are typically on port 2379 (same as gRPC) or 2381
		metricsURL = fmt.Sprintf("http://%s/metrics", endpoint)
	} else {
		// Use default endpoint
		endpoints := client.Endpoints()
		if len(endpoints) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no etcd endpoints available"})
			return
		}
		metricsURL = fmt.Sprintf("http://%s/metrics", endpoints[0])
	}

	// Fetch metrics from etcd HTTP endpoint
	req, err := http.NewRequestWithContext(ctx, "GET", metricsURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create request: %v", err)})
		return
	}

	// Add authentication if available
	if clusterConfig != nil && clusterConfig.Username != "" && clusterConfig.Password != "" {
		req.SetBasicAuth(clusterConfig.Username, clusterConfig.Password)
	}

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		// Try alternative port (2381 is common for metrics)
		if clusterConfig != nil {
			endpoint := normalizeEndpoint(clusterConfig.Endpoint)
			parts := strings.Split(endpoint, ":")
			if len(parts) == 2 {
				metricsURL = fmt.Sprintf("http://%s:2381/metrics", parts[0])
			} else {
				metricsURL = fmt.Sprintf("http://%s:2381/metrics", endpoint)
			}
		} else {
			endpoints := client.Endpoints()
			if len(endpoints) > 0 {
				parts := strings.Split(endpoints[0], ":")
				if len(parts) == 2 {
					metricsURL = fmt.Sprintf("http://%s:2381/metrics", parts[0])
				}
			}
		}

		req, err = http.NewRequestWithContext(ctx, "GET", metricsURL, nil)
		if err == nil {
			if clusterConfig != nil && clusterConfig.Username != "" && clusterConfig.Password != "" {
				req.SetBasicAuth(clusterConfig.Username, clusterConfig.Password)
			}
			resp, err = httpClient.Do(req)
		}

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch metrics: %v", err)})
			return
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("metrics endpoint returned status %d", resp.StatusCode)})
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to read metrics: %v", err)})
		return
	}

	// Parse Prometheus format metrics
	metrics := parsePrometheusMetrics(string(body))

	// Get cluster status for additional info
	statusResp, err := client.Status(ctx, client.Endpoints()[0])
	var members []MemberMetrics
	var summary MetricsSummary
	var serverVersion string
	var clusterID string

	if err == nil && statusResp != nil {
		serverVersion = statusResp.Version
		clusterID = fmt.Sprintf("%x", statusResp.Header.ClusterId)
		memberList, err := client.MemberList(ctx)
		if err == nil {
			for _, member := range memberList.Members {
				for _, endpoint := range member.ClientURLs {
					memberStatus, err := client.Status(ctx, endpoint)
					if err != nil {
						continue
					}

					isLeader := memberStatus.Leader == memberStatus.Header.MemberId
					memberMetrics := MemberMetrics{
						Endpoint:           endpoint,
						IsLeader:           isLeader,
						DBSize:             memberStatus.DbSize,
						DBSizeInUse:        memberStatus.DbSizeInUse,
						RaftIndex:          memberStatus.RaftIndex,
						RaftTerm:           memberStatus.RaftTerm,
						RaftAppliedIndex:   memberStatus.RaftAppliedIndex,
						RaftCommittedIndex: memberStatus.RaftIndex, // Use RaftIndex as committed index approximation
					}

					members = append(members, memberMetrics)

					if isLeader {
						summary.LeaderCount++
					} else {
						summary.FollowerCount++
					}
					summary.TotalDBSize += memberStatus.DbSize
					summary.TotalDBSizeInUse += memberStatus.DbSizeInUse
					break
				}
			}
		}

		summary.TotalKeys = statusResp.DbSize
	}

	// Extract key metrics from Prometheus format
	if val, ok := metrics["etcd_server_requests_total"]; ok {
		if f, ok := val.(float64); ok {
			summary.TotalRequests = f
		}
	}

	if val, ok := metrics["etcd_debugging_mvcc_keys_total"]; ok {
		if f, ok := val.(float64); ok {
			summary.TotalKeys = int64(f)
		}
	}

	// Extract Raft metrics
	if val, ok := metrics["etcd_server_proposals_total"]; ok {
		if f, ok := val.(float64); ok {
			summary.RaftProposals = f
		}
	}
	if val, ok := metrics["etcd_server_proposals_committed_total"]; ok {
		if f, ok := val.(float64); ok {
			summary.RaftCommitted = f
		}
	}
	if val, ok := metrics["etcd_server_proposals_applied_total"]; ok {
		if f, ok := val.(float64); ok {
			summary.RaftApplied = f
		}
	}

	// Ensure members is never nil
	if members == nil {
		members = []MemberMetrics{}
	}

	response := MetricsResponse{
		ServerVersion: serverVersion,
		ClusterID:     clusterID,
		Members:       members,
		Summary:       summary,
		RawMetrics:    metrics,
	}

	c.JSON(http.StatusOK, response)
}

// parsePrometheusMetrics parses Prometheus format metrics into a map
func parsePrometheusMetrics(metricsText string) map[string]interface{} {
	result := make(map[string]interface{})
	lines := strings.Split(metricsText, "\n")

	// Prometheus metric format: metric_name{labels} value
	metricRegex := regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(.+)$`)
	histogramRegex := regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)_(bucket|sum|count)\s+(.+)$`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Try to match regular metric
		matches := metricRegex.FindStringSubmatch(line)
		if len(matches) == 3 {
			metricName := matches[1]
			valueStr := matches[2]

			// Parse value
			if value, err := strconv.ParseFloat(valueStr, 64); err == nil {
				// For histograms, aggregate bucket values
				if strings.HasSuffix(metricName, "_bucket") {
					baseName := strings.TrimSuffix(metricName, "_bucket")
					if existing, ok := result[baseName].(float64); ok {
						result[baseName] = existing + value
					} else {
						result[baseName] = value
					}
				} else {
					result[metricName] = value
				}
			}
			continue
		}

		// Try to match histogram metric
		histMatches := histogramRegex.FindStringSubmatch(line)
		if len(histMatches) == 4 {
			baseName := histMatches[1]
			suffix := histMatches[2]
			valueStr := histMatches[3]

			if value, err := strconv.ParseFloat(valueStr, 64); err == nil {
				key := fmt.Sprintf("%s_%s", baseName, suffix)
				result[key] = value
			}
		}
	}

	return result
}
