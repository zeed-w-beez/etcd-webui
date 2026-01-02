package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/etcd-webui/backend/config"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	clientv3 "go.etcd.io/etcd/client/v3"
)

type Handler struct {
	Client *clientv3.Client
	Prefix string
}

type EtcdKey struct {
	Key   string `json:"key"`
	Value string `json:"value"`
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
	Key   string `json:"key"`
	Value string `json:"value"`
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

func NewHandler(client *clientv3.Client) *Handler {
	return &Handler{
		Client: client,
		Prefix: "",
	}
}

func (h *Handler) Connect(cfg *config.Config) error {
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{cfg.EtcdEndpoint},
		DialTimeout: cfg.GetDialTimeout(),
		Username:    cfg.Username,
		Password:    cfg.Password,
	})
	if err != nil {
		return err
	}

	h.Client = cli
	return nil
}

func (h *Handler) HealthCheck(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	status := HealthStatus{
		Status: "unhealthy",
		Etcd:   "disconnected",
	}

	if h.Client == nil {
		status.Error = "etcd client not initialized"
		c.JSON(http.StatusServiceUnavailable, status)
		return
	}

	resp, err := h.Client.Status(ctx, h.Client.Endpoints()[0])
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

	prefix := c.Query("prefix")

	opts := []clientv3.OpOption{}
	if prefix != "" {
		opts = append(opts, clientv3.WithPrefix())
	}

	resp, err := h.Client.Get(ctx, prefix, opts...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	keys := make([]EtcdKey, 0, resp.Count)
	for _, kv := range resp.Kvs {
		key := EtcdKey{
			Key:   string(kv.Key),
			Value: string(kv.Value),
		}
		keys = append(keys, key)
	}

	c.JSON(http.StatusOK, KeysResponse{Keys: keys})
}

func (h *Handler) GetKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	resp, err := h.Client.Get(ctx, key)
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
		Key:   string(kv.Key),
		Value: string(kv.Value),
	})
}

func (h *Handler) CreateKey(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var req CreateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.Client.Put(ctx, req.Key, req.Value)
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

	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	var req UpdateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.Client.Put(ctx, key, req.Value)
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

	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	delOpts := []clientv3.OpOption{}
	if strings.HasSuffix(key, "/") || strings.Contains(key, "*") {
		delOpts = append(delOpts, clientv3.WithPrefix())
	}

	delResp, err := h.Client.Delete(ctx, key, delOpts...)
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

	var req DeleteKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	deleted := 0
	for _, key := range req.Keys {
		delResp, err := h.Client.Delete(ctx, key)
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

	resp, err := h.Client.Get(ctx, "", clientv3.WithPrefix())
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

	var keys []EtcdKey
	if err := c.ShouldBindJSON(&keys); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Start a transaction to ensure atomicity
	txn := h.Client.Txn(ctx)
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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	Role      string `json:"role"` // leader or follower
	Version   string `json:"version"`
	DBSize    int64  `json:"dbSize"`
	IsLeader  bool   `json:"isLeader"`
	StartTime string `json:"startTime"`
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

	// Create context that cancels when the WebSocket connection closes
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	// Watch etcd for changes
	watchChan := h.Client.Watch(ctx, prefix, clientv3.WithPrefix())

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
				if len(event.PrevKv.Value) > 0 {
					watchEvent.OldValue = string(event.PrevKv.Value)
				}
			case clientv3.EventTypeDelete:
				watchEvent.Type = "DELETE"
				watchEvent.OldValue = string(event.PrevKv.Value)
			}

			// Send event to client
			if err := conn.WriteJSON(watchEvent); err != nil {
				log.Printf("Failed to write watch event to WebSocket: %v", err)
				return
			}
		}
	}
}

// ClusterStatus represents the overall etcd cluster status
func (h *Handler) ClusterStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// Get status of all members
	memberList, err := h.Client.MemberList(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get current revision from a simple range query
	resp, err := h.Client.Get(ctx, "", clientv3.WithLimit(1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get leader info from status of first endpoint
	var leaderID uint64
	var nodes []ClusterNode

	for _, member := range memberList.Members {
		// Try to get status for each endpoint
		for _, endpoint := range member.ClientURLs {
			status, err := h.Client.Status(ctx, endpoint)
			if err != nil {
				continue
			}

			leaderID = status.Leader

			node := ClusterNode{
					ID:        fmt.Sprintf("%d", member.ID),
					Name:      member.Name,
					Endpoint:  endpoint,
					Role:      "follower",
					Version:   status.Version,
					DBSize:    status.DbSize,
					IsLeader:  member.ID == leaderID,
					StartTime: time.Now().Format(time.RFC3339),
				}

			if node.IsLeader {
				node.Role = "leader"
			}

			nodes = append(nodes, node)
			break // Only use the first working endpoint for each member
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"members":       nodes,
		"leader":        leaderID,
		"revision":      resp.Header.Revision,
		"clusterSize":   len(nodes),
		"etcdVersion":   nodes[0].Version,
		"leaderCount":   len(nodes) - 1,
		"followerCount": len(nodes) - 1,
	})
}

func (h *Handler) Close() {
	if h.Client != nil {
		h.Client.Close()
	}
}

func decodeKey(key string) string {
	if decoded, err := base64.StdEncoding.DecodeString(key); err == nil {
		return string(decoded)
	}
	return key
}
