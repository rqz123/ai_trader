#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  AI Trader — One-time environment setup
#  Usage: bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==================================================="
echo "  AI Trader — Environment Setup"
echo "==================================================="

# Check python3
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found. Install Python 3.10+ first."
  exit 1
fi

PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python $PYTHON_VER detected"

# Create virtual environment
if [ ! -d "venv" ]; then
  echo "Creating venv..."
  python3 -m venv venv
else
  echo "venv already exists — skipping creation"
fi

# Activate venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip --quiet

# Install dependencies
echo "Installing dependencies from requirements.txt..."
pip install -r requirements.txt

echo ""
echo "==================================================="
echo "  Setup complete!"
echo ""
echo "  To start the application:"
echo "    bash start.sh"
echo ""
echo "  To stop:"
echo "    bash stop.sh"
echo "==================================================="
