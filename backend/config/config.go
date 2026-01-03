package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	ServerPort int    `mapstructure:"server_port"`
	LogLevel   string `mapstructure:"log_level"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()

	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	v.SetDefault("server_port", 8080)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
	}

	v.SetEnvPrefix("ETCD_WEBUI")
	v.BindEnv("server_port", "SERVER_PORT")
	v.BindEnv("log_level", "LOG_LEVEL")

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}
