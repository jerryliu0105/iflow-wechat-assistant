#!/bin/bash

echo "========================================"
echo "  iFlow 企业微信助手 - 安装脚本"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js 版本: $NODE_VERSION"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未检测到 npm"
    exit 1
fi

NPM_VERSION=$(npm -v)
echo "✅ npm 版本: $NPM_VERSION"

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  未检测到 .env 配置文件"
    if [ -f ".env.example" ]; then
        echo "📝 正在从 .env.example 创建 .env ..."
        cp .env.example .env
        echo "✅ 已创建 .env 文件，请编辑此文件填写你的配置"
    else
        echo "❌ 未找到 .env.example 模板文件"
    fi
fi

# 安装依赖
echo ""
echo "📦 正在安装依赖..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "✅ 安装完成！"
    echo ""
    echo "接下来的步骤："
    echo "1. 编辑 .env 文件，填写你的企业微信配置"
    echo "2. 运行 npm start 启动服务"
    echo ""
    echo "详细教程请查看 TUTORIAL.md"
    echo "========================================"
else
    echo ""
    echo "❌ 依赖安装失败，请检查网络连接或 npm 配置"
    exit 1
fi
