#!/bin/bash
# Setup script for EC2 instance - Traductor Auth Server

set -e

echo "🔧 Updating system..."
sudo yum update -y

echo "🐳 Installing Docker..."
sudo yum install -y docker git
sudo service docker start
sudo usermod -a -G docker ec2-user

echo "📦 Installing Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

echo "✅ Setup complete!"
echo "Docker version: $(docker --version)"
echo "Node version: $(node --version)"
