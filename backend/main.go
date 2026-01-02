package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/etcd-webui/backend/config"
	"github.com/etcd-webui/backend/internal/handlers"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"go.etcd.io/etcd/client/v3"
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
		client: cli,
		prefix: "",
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

	api := r.Group("/api")
	{
		api.GET("/health", h.HealthCheck)
		api.GET("/keys", h.GetKeys)
		api.GET("/keys/:key", h.GetKey)
		api.POST("/keys", h.CreateKey)
		api.PUT("/keys/:key", h.UpdateKey)
		api.DELETE("/keys/:key", h.DeleteKey)
		api.DELETE("/keys", h.DeleteKeys)
	}

	staticDir := cfg.StaticDir
	if staticDir == "" {
		staticDir = "../frontend/dist"
	}

	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		log.Printf("Warning: Static directory not found: %s", staticDir)
		log.Println("Frontend must be built first. Run 'npm run build' in the frontend directory.")
	} else {
		r.NoRoute(func(c *gin.Context) {
			filePath := staticDir + c.Request.URL.Path
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				c.File(staticDir + "/index.html")
			} else {
				c.File(filePath)
			}
		})
		r.StaticFile("/", staticDir+"/index.html")
		r.Static("/assets", staticDir+"/assets")
	}

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

	log.Printf("Starting server on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}

	log.Println("Server stopped")
}
