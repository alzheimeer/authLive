#!/bin/bash
# ============================================================================
# Traductor Auth Server - Deploy Script
# ============================================================================
# Uso: ./scripts/deploy.sh [staging|production]
# ============================================================================

set -e

ENV=${1:-production}
echo "🚀 Deploying to $ENV..."

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo "❌ Fly CLI not installed. Install with:"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo "❌ Not logged in to Fly.io. Run: fly auth login"
    exit 1
fi

# Deploy based on environment
if [ "$ENV" = "staging" ]; then
    echo "📦 Deploying to staging..."
    fly deploy --config fly.staging.toml
else
    echo "📦 Deploying to production..."
    fly deploy
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Check status: fly status"
echo "📜 View logs: fly logs"
echo "🌐 Open app: fly open"
