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

	"github.com/etcd-webui/backend/config"
	"github.com/etcd-webui/backend/internal/handlers"
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

	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   []string{cfg.EtcdEndpoint},
		DialTimeout: cfg.GetDialTimeout(),
		Username:    cfg.Username,
		Password:    cfg.Password,
	})
	if err != nil {
		log.Fatalf("Failed to connect to etcd: %v", err)
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = cli.Status(ctx, cfg.EtcdEndpoint)
	if err != nil {
		log.Printf("Warning: Failed to connect to etcd at %s: %v", cfg.EtcdEndpoint, err)
		log.Println("Make sure etcd is running. The server will start but some features may not work.")
	}

	h := &handlers.Handler{
		Client: cli,
		Prefix: "",
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = []string{"*"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	r.Use(cors.New(corsConfig))

	staticDir := cfg.StaticDir
	if staticDir == "" {
		staticDir = "../frontend/dist"
	}

	// Setup static files first (but after API routes are defined)
	var staticExists bool
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		log.Printf("Warning: Static directory not found: %s", staticDir)
		log.Println("Frontend must be built first. Run 'npm run build' in the frontend directory.")
		staticExists = false
	} else {
		staticExists = true
	}

	// API routes - 定义这些路由 BEFORE static files
	api := r.Group("/api")
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
