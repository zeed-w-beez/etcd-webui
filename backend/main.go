package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zeed-w-beez/etcd-webui/backend/config"
	"github.com/zeed-w-beez/etcd-webui/backend/internal/handlers"
	"github.com/zeed-w-beez/etcd-webui/backend/internal/logger"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	clientv3 "go.etcd.io/etcd/client/v3"
)

func main() {
	configPath := flag.String("config", "config.yaml", "Path to configuration file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	logger.Init(cfg)

	// 默认etcd端点设置
	etcdEndpoint := "localhost:2379"

	// 使用默认超时值5秒创建默认etcd客户端
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{etcdEndpoint},
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		log.Fatalf("Failed to connect to etcd: %v", err)
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = cli.Status(ctx, etcdEndpoint)
	if err != nil {
		log.Printf("Warning: Failed to connect to etcd at %s: %v", etcdEndpoint, err)
		log.Println("Make sure etcd is running. The server will start but some features may not work.")
	}

	// 创建 ClientManager 实例
	clientManager := handlers.NewClientManager()
	
	// 创建 Handler 实例
	h := handlers.NewHandler(cli, clientManager, cfg)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = []string{"*"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	r.Use(cors.New(corsConfig))

	// Auto-detect static directory with priority
	var staticDir string
	var staticExists bool
	potentialDirs := []string{"./dist", "./frontend/dist", "../frontend/dist"}

	for _, dir := range potentialDirs {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			staticDir = dir
			staticExists = true
			break
		}
	}

	if !staticExists {
		log.Printf("Warning: Static directory not found in any of the locations: %v", potentialDirs)
		log.Println("Frontend must be built first. Run 'npm run build' in the frontend directory.")
	}

	// API routes - 定义这些路由 BEFORE static files
	api := r.Group("/api")
	// 添加 ClusterMiddleware 来处理集群配置
	api.Use(h.ClusterMiddleware())
	{
		api.GET("/health", h.HealthCheck)
		api.GET("/keys", h.GetKeys)
		api.POST("/keys", h.CreateKey)
		api.PUT("/keys", h.UpdateKey)
		api.DELETE("/keys", h.DeleteKey)
		api.DELETE("/keys/batch", h.DeleteKeys)
		api.GET("/keys/export", h.ExportKeys)
		api.POST("/keys/import", h.ImportKeys)
		api.GET("/keys/versions", h.GetKeyVersions)
		api.GET("/keys/history", h.GetKeyHistory)
		api.GET("/cluster/status", h.ClusterStatus)
		api.POST("/cluster/compact", h.Compact)
		api.POST("/cluster/defrag", h.Defrag)
		api.GET("/cluster/metrics", h.GetMetrics)
		api.GET("/watch", h.Watch)
	}

	// Static files
	if staticExists {
		r.StaticFile("/", staticDir+"/index.html")
		r.Static("/assets", staticDir+"/assets")
	}

	// Catch-all handler for client-side routing
	r.NoRoute(func(c *gin.Context) {
		if staticExists && !strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.File(staticDir + "/index.html")
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": "Endpoint not found"})
		}
	})

	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		log.Println("Shutting down server...")
		srv.Close()
	}()

	log.Printf("Starting server on http://localhost%s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}

	log.Println("Server stopped")
}
