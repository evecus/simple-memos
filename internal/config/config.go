package config

import (
	"flag"
	"os"
	"path/filepath"
)

type Config struct {
	DataDir string
	Addr    string
}

func Parse() (*Config, error) {
	cfg := &Config{}

	defaultData := defaultDataDir()
	flag.StringVar(&cfg.DataDir, "d", defaultData, "data directory (SQLite + attachments)")
	flag.StringVar(&cfg.Addr, "addr", "127.0.0.1:5230", "listen address")
	flag.Parse()

	abs, err := filepath.Abs(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	cfg.DataDir = abs
	return cfg, nil
}

func defaultDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "data"
	}
	return filepath.Join(filepath.Dir(exe), "data")
}
