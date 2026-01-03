package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	EtcdEndpoint string `mapstructure:"etcd_endpoint"`
	ServerPort   int    `mapstructure:"server_port"`
	StaticDir    string `mapstructure:"static_dir"`
	DialTimeout  int    `mapstructure:"dial_timeout"`
	Username     string `mapstructure:"username"`
	Password     string `mapstructure:"password"`
	LogLevel     string `mapstructure:"log_level"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()

	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	v.SetDefault("server_port", 8080)
	v.SetDefault("static_dir", "../frontend/dist")
	v.SetDefault("dial_timeout", 5)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
	}

	v.SetEnvPrefix("ETCD_WEBUI")
	v.BindEnv("etcd_endpoint", "ETCD_ENDPOINT")
	v.BindEnv("server_port", "SERVER_PORT")
	v.BindEnv("static_dir", "STATIC_DIR")
	v.BindEnv("dial_timeout", "DIAL_TIMEOUT")
	v.BindEnv("username", "ETCD_USERNAME")
	v.BindEnv("password", "ETCD_PASSWORD")
	v.BindEnv("log_level", "LOG_LEVEL")

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	if cfg.EtcdEndpoint == "" {
		cfg.EtcdEndpoint = "localhost:2379"
	}

	return &cfg, nil
}

func (c *Config) GetDialTimeout() time.Duration {
	return time.Duration(c.DialTimeout) * time.Second
}
