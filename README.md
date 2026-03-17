# iFlow 企业微信 & 飞书助手

> 通过企业微信或飞书远程控制电脑上的 iFlow CLI，随时随地用手机操控 AI 编程助手。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

## ✨ 功能特点

- 🚀 **开箱即用** - 只需修改几个配置项即可使用
- 💬 **连续对话** - 自动保持会话上下文，支持多轮交互
- 📱 **随时随地** - 用手机控制电脑上的 AI 助手
- 🔀 **多平台支持** - 同时支持企业微信和飞书两大平台
- 📝 **日志记录** - 完整的执行日志，方便排查问题
- ⚡ **零代码** - 纯配置方式使用，无需写代码

## 📋 前置要求

1. **Node.js** >= 16.0.0
2. **iFlow CLI** 已安装（[安装指南](https://github.com/iflow-ai/iflow-cli)）
3. 根据使用的平台：
   - **企业微信**：需要管理员权限创建自建应用 + **cloudflared**（内网穿透）
   - **飞书**：需要在飞书开放平台创建应用（使用 WebSocket 长连接，**无需内网穿透**）

---

## 🛠️ 快速开始

### 通用步骤：克隆项目并安装依赖

```bash
git clone https://github.com/wx7in8/iflow-wechat-assistant.git
cd iflow-wechat-assistant
npm install
```

> 💡 也可使用安装脚本：Mac/Linux 运行 `npm run install:mac`，Windows 运行 `npm run install:win`

---

## 方式一：企业微信接入

### 第一步：创建企业微信应用

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)

2. **获取企业 ID**
   - 点击「我的企业」→ 复制「企业ID」

3. **创建自建应用**
   - 点击「应用管理」→「自建」→「创建应用」
   - 填写应用名称（如：iFlow 助手）
   - 创建后获取 **AgentId** 和 **Secret**

4. **获取你的 UserID**
   - 打开企业微信 App → 点击「我」→ 点击头像
   - 查看「账号」就是你的 UserID

### 第二步：配置环境变量

```bash
# 复制配置模板
cp .env.example .env
```

编辑 `.env` 文件，填入以下配置：

```env
# 企业微信配置（必填）
CORP_ID=你的企业ID
AGENT_ID=你的应用AgentId
SECRET=你的应用Secret
USER_ID=你的用户账号

# 服务端口（可选，默认 3000）
PORT=3000
```

### 第三步：配置 IP 白名单

1. 获取你的公网 IP：
```bash
curl -4 -s ifconfig.me
```

2. 在企业微信后台 → 应用管理 → 你的应用 → 「企业可信IP」→ 添加你的公网 IP

### 第四步：启动服务

```bash
npm start
```

看到以下输出表示成功：
```
[Startup] 企业微信连接成功 ✓
[Server] 服务已启动，端口: 3000
```

此时你会收到企业微信的消息：**iFlow 服务已启动** 🚀

### 第五步：配置内网穿透（用于接收消息）

**新开一个终端窗口**，运行：

```bash
cloudflared tunnel --url http://localhost:3000
```

你会看到类似输出：
```
Your quick Tunnel has been created! Visit it at:
https://xxx-xxx-xxx.trycloudflare.com
```

记下这个域名，后面需要用到。

### 第六步：配置消息回调

1. 在企业微信后台 → 应用管理 → 你的应用 → 「接收消息」→「设置 API 接收」

2. 填写以下信息：
   - **URL**：`https://你的隧道域名/wechat/callback`
   - **Token**：任意字符串（如：`mytoken123`）
   - **EncodingAESKey**：点击「随机获取」

3. 将 Token 和 EncodingAESKey 填入 `.env` 文件：
```env
RECEIVE_TOKEN=你填写的Token
RECEIVE_ENCODING_AES_KEY=随机获取的EncodingAESKey
```

4. 重启服务使配置生效

### 第七步：配置可信域名

1. 在企业微信后台 → 应用管理 → 你的应用 → 「企业可信IP」下方的「可信域名」

2. 点击「设置」→「添加」→ 输入你的隧道域名（不带 https://）

3. 点击「验证」，下载验证文件

4. 将验证文件信息填入 `.env`：
```env
WW_VERIFY_FILENAME=WW_verify_xxx.txt
WW_VERIFY_CONTENT=验证文件内容
```

5. 重启服务后再次验证

### 完成！

在企业微信 App 中给你的应用发送消息测试。

---

## 方式二：飞书接入

> 🎉 飞书版使用 WebSocket 长连接，**无需配置内网穿透**，接入更简单！

### 第一步：创建飞书应用

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 点击「创建企业自建应用」
3. 填写应用名称和描述
4. 在「凭证与基础信息」页面获取 **App ID** 和 **App Secret**

### 第二步：配置应用权限

在飞书开放平台 → 你的应用 → 「权限管理」中，添加以下权限：

| 权限名称 | 说明 |
|----------|------|
| `im:message` | 获取与发送单聊、群组消息 |
| `im:message:send_as_bot` | 以应用的身份发送消息 |

### 第三步：启用机器人能力

1. 在应用管理页面 → 「添加应用能力」→ 启用「机器人」
2. 发布应用版本，等待管理员审批通过

### 第四步：配置环境变量

```bash
# 复制飞书配置模板
cp .env.feishu.example .env
```

编辑 `.env` 文件：

```env
# 飞书应用配置（必填）
FEISHU_APP_ID=你的应用AppID
FEISHU_APP_SECRET=你的应用AppSecret
```

### 第五步：启动服务

```bash
npm run start:feishu
```

看到以下输出表示成功：
```
[Startup] 飞书长连接已建立 ✓
[Startup] 等待飞书消息...
```

### 完成！

在飞书中找到你的机器人，发送消息即可开始使用。

---

## 📖 使用方法

在企业微信或飞书中发送消息：

| 命令 | 说明 |
|------|------|
| 直接发送文本 | 执行 iFlow 命令（自动恢复上次会话） |
| `/run <自然语言>` | 显式把自然语言交给 iFlow CLI 处理（不保证直接执行本机命令） |
| `/help` | 显示帮助信息 |
| `/status` | 查看服务状态和当前会话 |
| `/new` | 开始新会话（清除上下文） |
| `/sessions` | 查看历史会话列表 |
| `/menu` | 显示快捷菜单（飞书） |
| `/ls [path]` | 列出本地路径内容（需配置白名单） |
| `/open <path>` | 在电脑上打开文件/目录（需配置白名单） |
| `/read <path>` | 读取本地文本文件内容（需配置白名单） |
| `/exec <cmd>` | 在电脑上执行脚本命令（需配置白名单，仅支持 `python/py/node`） |
| `整理文件 <path>: <要求>` | 读取文件后交给 iFlow 整理并返回结果（不写回） |
| `修改文件 <path>: <要求>` | 读取文件后交给 iFlow 修改并写回本地文件（高风险，建议先备份） |

> ⚠️ 本地路径/脚本执行默认受 `IFLOW_LOCAL_ALLOWLIST` 限制（逗号分隔的绝对路径白名单）。未配置白名单时，`/open`、`/read`、`/ls`、`/exec` 会拒绝执行。

### 连续对话示例

```
用户: 帮我写一个 Python 爬虫脚本
iFlow: [创建脚本...]

用户: 再帮我添加异常处理
iFlow: [在之前的基础上修改...] ← 自动保持上下文

用户: 继续完善，添加日志功能
iFlow: [继续修改同一文件...] ← 仍然保持上下文
```

## 🔧 常见问题

### Q: 启动时提示端口被占用？

```bash
# Mac/Linux
lsof -i :3000 -t | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <进程ID> /F
```

### Q: 提示 "not allow to access from your ip"？

需要在企业微信后台添加 IP 白名单：
1. 获取公网 IP：`curl -4 -s ifconfig.me`
2. 企业微信后台 → 应用管理 → 企业可信IP → 添加

### Q: 收不到消息回复？

按顺序检查：
1. 内网穿透是否正常运行（企业微信模式）
2. 消息回调 URL 是否正确配置（企业微信模式）
3. Token 和 EncodingAESKey 是否正确（企业微信模式）
4. 可信域名是否验证通过（企业微信模式）
5. 飞书模式下检查 App ID 和 App Secret 是否正确
6. 飞书模式下检查机器人能力是否已启用并审批通过

### Q: 每次启动隧道域名都变化？（企业微信）

Quick Tunnel 每次启动会生成新域名。如需固定域名：
1. 将自己的域名托管到 Cloudflare（免费）
2. 创建命名隧道：`cloudflared tunnel create my-tunnel`
3. 配置 DNS 路由到隧道

详细说明见 [TUTORIAL.md](TUTORIAL.md)

### Q: 如何查看执行日志？

```bash
tail -f logs/iflow.log
```

### Q: 企业微信和飞书有什么区别？

| 对比项 | 企业微信 | 飞书 |
|--------|---------|------|
| 连接方式 | HTTP 回调 + 内网穿透 | WebSocket 长连接 |
| 内网穿透 | ✅ 需要 (cloudflared) | ❌ 不需要 |
| 配置复杂度 | 较高（7 步） | 较低（5 步） |
| 消息格式 | XML 加解密 | JSON |
| 启动命令 | `npm start` | `npm run start:feishu` |

## 📁 项目结构

```
iflow-wechat-assistant/
├── src/
│   ├── index.js          # 企业微信主服务、路由处理
│   ├── wechat.js         # 企业微信 API 封装
│   ├── crypto.js         # 企业微信消息加解密
│   ├── feishu-index.js   # 飞书主服务、事件处理
│   ├── feishu.js         # 飞书 API 封装（含富文本转换）
│   └── iflow.js          # iFlow 命令处理、会话管理（共用）
├── logs/                 # 日志目录
├── .env.example          # 企业微信配置模板
├── .env.feishu.example   # 飞书配置模板
├── .env                  # 你的配置（需自行创建）
├── package.json
├── install.sh            # Mac/Linux 安装脚本
├── install.bat           # Windows 安装脚本
├── README.md             # 本文件
├── TUTORIAL.md           # 详细教程（企业微信）
└── LICENSE               # MIT 许可证
```

## ⚙️ 配置说明

### 企业微信配置

#### 必填配置

| 配置项 | 说明 | 获取位置 |
|--------|------|----------|
| `CORP_ID` | 企业 ID | 管理后台 → 我的企业 |
| `AGENT_ID` | 应用 ID | 应用管理 → 你的应用 |
| `SECRET` | 应用密钥 | 应用管理 → 你的应用 → 查看 |
| `USER_ID` | 你的账号 | 企业微信 App → 个人资料 |

#### 消息回调配置

| 配置项 | 说明 |
|--------|------|
| `RECEIVE_TOKEN` | 消息验证 Token（自定义） |
| `RECEIVE_ENCODING_AES_KEY` | 消息加密密钥（随机生成） |

#### 可选配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `WW_VERIFY_FILENAME` | 域名验证文件名 | - |
| `WW_VERIFY_CONTENT` | 域名验证文件内容 | - |

### 飞书配置

| 配置项 | 说明 | 获取位置 |
|--------|------|----------|
| `FEISHU_APP_ID` | 应用 App ID | 飞书开放平台 → 凭证与基础信息 |
| `FEISHU_APP_SECRET` | 应用 App Secret | 飞书开放平台 → 凭证与基础信息 |

## 🚀 启动命令一览

| 命令 | 说明 |
|------|------|
| `npm start` | 启动企业微信模式 |
| `npm run start:feishu` | 启动飞书模式 |
| `npm run dev` | 企业微信开发模式（自动重启） |
| `npm run dev:feishu` | 飞书开发模式（自动重启） |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT License](LICENSE)

---

**⭐ 如果这个项目对你有帮助，欢迎 Star！**
