.PHONY: dev build test clean install dev-desktop dev-server dev-mcp build-engine

# 默认目标
all: install build

# ==================== 安装依赖 ====================

install:
	@echo "📦 Installing dependencies..."
	pnpm install
	uv sync
	@echo "✅ Dependencies installed"

# ==================== 开发模式 ====================

dev:
	@echo "🚀 Starting StratCraft in development mode..."
	@make -j3 dev-desktop dev-server dev-mcp

dev-desktop:
	@echo "🖥️  Starting Electron..."
	cd apps/desktop && pnpm run dev

dev-server:
	@echo "🐍 Starting FastAPI..."
	cd apps/server && uv run uvicorn src.main:app --reload --port 8000

dev-mcp:
	@echo "🤖 Starting MCP Server..."
	cd packages/mcp-server && uv run python -m src.server

# ==================== 构建 ====================

build:
	@echo "🔨 Building all packages..."
	pnpm run build
	@echo "✅ Build completed"

build-desktop:
	@echo "🔨 Building desktop app..."
	cd apps/desktop && pnpm run build

build-engine:
	@echo "🔨 Building C++ engine..."
	cd packages/core-engine && \
	cmake -B build -DCMAKE_BUILD_TYPE=Release && \
	cmake --build build --config Release
	@echo "✅ C++ engine built"

# ==================== 打包 ====================

package:
	@echo "📦 Packaging desktop app..."
	cd apps/desktop && pnpm run package

package-win:
	@echo "📦 Packaging for Windows..."
	cd apps/desktop && pnpm run package:win

package-mac:
	@echo "📦 Packaging for macOS..."
	cd apps/desktop && pnpm run package:mac

package-linux:
	@echo "📦 Packaging for Linux..."
	cd apps/desktop && pnpm run package:linux

# ==================== 测试 ====================

test:
	@echo "🧪 Running tests..."
	pnpm run test
	uv run pytest
	@echo "✅ All tests passed"

test-desktop:
	cd apps/desktop && pnpm run test

test-server:
	cd apps/server && uv run pytest

# ==================== 代码质量 ====================

lint:
	@echo "🔍 Linting..."
	pnpm run lint
	uv run ruff check .
	@echo "✅ Lint passed"

format:
	@echo "✨ Formatting..."
	uv run ruff format .
	@echo "✅ Format completed"

typecheck:
	@echo "🔍 Type checking..."
	uv run mypy apps/server packages/mcp-server
	@echo "✅ Type check passed"

# ==================== 清理 ====================

clean:
	@echo "🧹 Cleaning..."
	pnpm run clean
	rm -rf node_modules
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".venv" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	cd packages/core-engine && rm -rf build 2>/dev/null || true
	@echo "✅ Clean completed"

# ==================== 帮助 ====================

help:
	@echo "StratCraft Makefile Commands:"
	@echo ""
	@echo "  make install      - Install all dependencies"
	@echo "  make dev          - Start all services in dev mode"
	@echo "  make dev-desktop  - Start Electron only"
	@echo "  make dev-server   - Start FastAPI only"
	@echo "  make build        - Build all packages"
	@echo "  make build-engine - Build C++ engine"
	@echo "  make package      - Package desktop app"
	@echo "  make test         - Run all tests"
	@echo "  make lint         - Run linters"
	@echo "  make clean        - Clean build artifacts"
