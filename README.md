# iFlow 企业微信助手

通过企业微信控制电脑上的 iFlow CLI。

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置
编辑 `.env` 文件，填入你的企业微信配置。

### 3. 启动服务
```bash
npm start
```

### 4. 测试连接
启动后会自动发送测试消息到你的企业微信。

## 使用方法

在企业微信应用中发送消息：

- 直接发送文本：执行 iFlow 命令
- `/help`：显示帮助
- `/status`：查看服务状态

## 接收消息（需要内网穿透）

如果需要从企业微信接收消息，需要：

1. 在企业微信后台设置「接收消息」的 URL
2. 配置内网穿透（如 ngrok、frp）

## 文件结构

```
iflow-app/
├── src/
│   ├── index.js    # 主服务
│   ├── wechat.js   # 企业微信 API
│   └── iflow.js    # iFlow 命令处理
├── .env            # 配置文件
└── package.json
```
