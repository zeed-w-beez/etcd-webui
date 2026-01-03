package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
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

// GetClient returns the etcd client for the given cluster ID, or creates a new one if it doesn't exist
func (cm *ClientManager) GetClient(clusterConfig *ClusterConfig) (*clientv3.Client, error) {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Check if client already exists for this cluster
	if client, exists := cm.clients[clusterConfig.ID]; exists {
		// Check if configuration has changed
		if cfg, exists := cm.configs[clusterConfig.ID]; exists && cfg.Endpoint == clusterConfig.Endpoint && cfg.Username == clusterConfig.Username && cfg.Password == clusterConfig.Password && cfg.DialTimeout == clusterConfig.DialTimeout {
			return client, nil
		}
		// Close old client if configuration has changed
		client.Close()
	}

	// Set default dial timeout if not provided
	dialTimeout := 5 // Default 5 seconds
	if clusterConfig.DialTimeout > 0 {
		dialTimeout = clusterConfig.DialTimeout
	}

	// Create new client
	clientConfig := clientv3.Config{
		Endpoints:   []string{clusterConfig.Endpoint},
		DialTimeout: time.Duration(dialTimeout) * time.Second,
	}

	// Add authentication if provided
	if clusterConfig.Username != "" && clusterConfig.Password != "" {
		clientConfig.Username = clusterConfig.Username
		clientConfig.Password = clusterConfig.Password
	}

	cli, err := clientv3.New(clientConfig)
	if err != nil {
		return nil, err
	}

	// Store client and configuration
	cm.clients[clusterConfig.ID] = cli
	cm.configs[clusterConfig.ID] = clusterConfig

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

		// Store client in context
		c.Set("etcdClient", client)
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

		for rev := startRev; rev <= currentModRev; rev++ {
			histResp, err := client.Get(ctx, key, clientv3.WithRev(rev), clientv3.WithLimit(1))
			if err == nil && histResp.Count > 0 {
				histKv := histResp.Kvs[0]
				version := histKv.Version
				if existingRev, exists := versionsMap[version]; !exists || existingRev < histKv.ModRevision {
					versionsMap[version] = histKv.ModRevision
				}
			}
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

	// Get leader info from status of first endpoint
	var leaderID uint64
	var leaderNodeID string
	var nodes []ClusterNode
	var totalDBSize int64
	var etcdVersion string
	var raftIndex uint64
	var raftTerm uint64
	var raftAppliedIndex uint64

	for _, member := range memberList.Members {
		// Try to get status for each endpoint
		for _, endpoint := range member.ClientURLs {
			status, err := client.Status(ctx, endpoint)
			if err != nil {
				continue
			}

			leaderID = status.Leader
			etcdVersion = status.Version
			raftIndex = status.RaftIndex
			raftTerm = status.RaftTerm
			raftAppliedIndex = status.RaftAppliedIndex

			node := ClusterNode{
				ID:               fmt.Sprintf("%d", member.ID),
				Name:             member.Name,
				Endpoint:         endpoint,
				Role:             "follower",
				Version:          status.Version,
				DBSize:           status.DbSize,
				IsLeader:         member.ID == leaderID,
				StartTime:        time.Now().Format(time.RFC3339),
				RaftIndex:        status.RaftIndex,
				RaftTerm:         status.RaftTerm,
				RaftAppliedIndex: status.RaftAppliedIndex,
			}

			if node.IsLeader {
				node.Role = "leader"
				leaderNodeID = fmt.Sprintf("%d", member.ID)
			}

			nodes = append(nodes, node)
			totalDBSize += status.DbSize
			break // Only use the first working endpoint for each member
		}
	}

	// Get total keys count using a proper range query
	var totalKeys int64
	keysResp, err := client.Get(ctx, "\x00", clientv3.WithFromKey(), clientv3.WithCountOnly())
	if err == nil {
		totalKeys = int64(keysResp.Count)
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
