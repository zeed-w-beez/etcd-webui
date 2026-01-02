package config

import (
	"os"
	"testing"
)

func TestLoad(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	configContent := `
etcd_endpoint: "localhost:2379"
server_port: 8080
static_dir: "./dist"
dial_timeout: 5
username: "testuser"
password: "testpass"
`
	if _, err := tmpFile.WriteString(configContent); err != nil {
		t.Fatalf("Failed to write config content: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if cfg.EtcdEndpoint != "localhost:2379" {
		t.Errorf("Expected etcd_endpoint 'localhost:2379', got '%s'", cfg.EtcdEndpoint)
	}

	if cfg.ServerPort != 8080 {
		t.Errorf("Expected server_port 8080, got %d", cfg.ServerPort)
	}

	if cfg.StaticDir != "./dist" {
		t.Errorf("Expected static_dir './dist', got '%s'", cfg.StaticDir)
	}

	if cfg.DialTimeout != 5 {
		t.Errorf("Expected dial_timeout 5, got %d", cfg.DialTimeout)
	}

	if cfg.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", cfg.Username)
	}

	if cfg.Password != "testpass" {
		t.Errorf("Expected password 'testpass', got '%s'", cfg.Password)
	}
}

func TestLoadDefaults(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString("etcd_endpoint: \"custom:2379\""); err != nil {
		t.Fatalf("Failed to write config content: %v", err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if cfg.EtcdEndpoint != "custom:2379" {
		t.Errorf("Expected etcd_endpoint 'custom:2379', got '%s'", cfg.EtcdEndpoint)
	}

	if cfg.ServerPort != 8080 {
		t.Errorf("Expected default server_port 8080, got %d", cfg.ServerPort)
	}
}

func TestLoadEnvOverride(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	configContent := `
etcd_endpoint: "localhost:2379"
server_port: 8080
`
	if _, err := tmpFile.WriteString(configContent); err != nil {
		t.Fatalf("Failed to write config content: %v", err)
	}
	tmpFile.Close()

	os.Setenv("ETCD_WEBUI_ETCD_ENDPOINT", "env-override:2379")
	defer os.Unsetenv("ETCD_WEBUI_ETCD_ENDPOINT")

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if cfg.EtcdEndpoint != "env-override:2379" {
		t.Errorf("Expected etcd_endpoint 'env-override:2379', got '%s'", cfg.EtcdEndpoint)
	}
}
