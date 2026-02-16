@echo off
chcp 65001 >nul
echo ========================================
echo   iFlow 企业微信助手 - 安装脚本
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 Node.js
    echo    下载地址: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✅ Node.js 版本: %NODE_VERSION%

REM 检查 npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ❌ 未检测到 npm
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo ✅ npm 版本: %NPM_VERSION%

REM 检查 .env 文件
if not exist ".env" (
    echo.
    echo ⚠️  未检测到 .env 配置文件
    if exist ".env.example" (
        echo 📝 正在从 .env.example 创建 .env ...
        copy .env.example .env >nul
        echo ✅ 已创建 .env 文件，请编辑此文件填写你的配置
    ) else (
        echo ❌ 未找到 .env.example 模板文件
    )
)

REM 安装依赖
echo.
echo 📦 正在安装依赖...
call npm install

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================
    echo ✅ 安装完成！
    echo.
    echo 接下来的步骤：
    echo 1. 编辑 .env 文件，填写你的企业微信配置
    echo 2. 运行 npm start 启动服务
    echo.
    echo 详细教程请查看 TUTORIAL.md
    echo ========================================
) else (
    echo.
    echo ❌ 依赖安装失败，请检查网络连接或 npm 配置
    pause
    exit /b 1
)

pause
