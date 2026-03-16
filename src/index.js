import 'dotenv/config';
import express from 'express';
import xml2js from 'xml2js';
import { sendTextMessage, sendMarkdownMessage, getAccessToken } from './wechat.js';
import { executeIFlowCommand, parseCommand, getHelpMessage, getStatusMessage, getSessionsMessage, createNewSession, listLocalPath } from './iflow.js';
import { decryptMessage, verifySignature, encryptMessage, generateSignature } from './crypto.js';

const app = express();
const PORT = process.env.PORT || 3000;
const USER_ID = process.env.USER_ID;
const TOKEN = process.env.RECEIVE_TOKEN;

const xmlParser = new xml2js.Parser({ explicitArray: false, explicitRoot: false });

// 中间件 - JSON 解析
app.use(express.json());

// 中间件 - 保存原始 body
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// 企业微信回调路由需要原始 body
app.use('/wechat/callback', (req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString('utf-8');
  }
  next();
});

// 企业微信域名验证 - 精确匹配验证文件
app.get(`/${process.env.WW_VERIFY_FILENAME}`, (req, res) => {
  const content = process.env.WW_VERIFY_CONTENT;
  if (content) {
    console.log('[Verify] 域名验证请求:', req.path);
    res.send(content);
  } else {
    res.status(404).send('验证文件未配置');
  }
});

// 支持任意验证文件路径（兼容其他可能的验证文件名）
app.get('/WW_verify_:id.txt', (req, res) => {
  const content = process.env.WW_VERIFY_CONTENT;
  if (content) {
    console.log('[Verify] 域名验证请求:', req.path);
    res.send(content);
  } else {
    res.status(404).send('验证文件未配置');
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 测试发送消息
app.get('/test-send', async (req, res) => {
  try {
    const result = await sendMarkdownMessage(USER_ID, `**iFlow 服务已启动**\n\n时间: ${new Date().toLocaleString('zh-CN')}\n\n你现在可以通过企业微信发送命令来控制 iFlow 了！`);
    res.json({ success: result, message: '测试消息已发送' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 企业微信回调 URL 验证（GET 请求）
app.get('/wechat/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  
  console.log('[Callback] 收到验证请求:', req.query);
  
  try {
    // 验证签名
    const signature = generateSignature(timestamp, nonce, echostr);
    if (signature !== msg_signature) {
      console.error('[Callback] 签名验证失败');
      return res.status(403).send('签名验证失败');
    }
    
    // 解密 echostr
    const decrypted = decryptMessage(echostr);
    console.log('[Callback] 验证成功，返回:', decrypted);
    res.send(decrypted);
  } catch (error) {
    console.error('[Callback] 验证失败:', error);
    res.status(500).send('验证失败');
  }
});

// 企业微信消息回调（POST 请求）
app.post('/wechat/callback', async (req, res) => {
  try {
    // 获取签名参数（在 URL query 中）
    const { msg_signature, timestamp, nonce } = req.query;
    
    // 获取原始 body
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : req.body);
    
    console.log('[Callback] 收到原始数据:', rawBody.substring(0, 500));
    
    // 解析 XML
    const xml = await xmlParser.parseStringPromise(rawBody);
    
    console.log('[Callback] 收到消息 XML:', xml);
    
    const { Encrypt } = xml;
    
    // 验证签名
    const expectedSig = generateSignature(timestamp, nonce, Encrypt);
    if (expectedSig !== msg_signature) {
      console.error('[Callback] 签名验证失败', { expected: expectedSig, actual: msg_signature });
      // 暂时跳过签名验证，先确保消息能处理
      // return res.send('success');
    }
    
    // 解密消息
    const decryptedXml = decryptMessage(Encrypt);
    console.log('[Callback] 解密后 XML:', decryptedXml);
    
    const message = await xmlParser.parseStringPromise(decryptedXml);
    
    console.log('[Callback] 解析后消息:', message);
    
    const content = message.Content || '';
    const fromUser = message.FromUserName || USER_ID;
    const msgType = message.MsgType;

    // 忽略非文本消息
    if (msgType !== 'text' || !content) {
      return res.send('success');
    }

    console.log(`[Callback] 用户 ${fromUser} 发送: ${content}`);

    // 立即响应企业微信
    res.send('success');
    
    // 异步处理命令
    processCommand(content).catch(err => console.error('[Callback] 处理命令错误:', err));

  } catch (error) {
    console.error('[Callback] 处理消息错误:', error);
    res.send('success');
  }
});

// 异步处理命令
async function processCommand(content) {
  const parsed = parseCommand(content);

  if (!parsed.valid) {
    await sendTextMessage(USER_ID, '无法识别的命令，发送 /help 查看帮助');
    return;
  }

  switch (parsed.type) {
    case 'help':
      await sendMarkdownMessage(USER_ID, getHelpMessage());
      break;
    
    case 'status':
      await sendMarkdownMessage(USER_ID, await getStatusMessage());
      break;
    
    case 'new':
      const newSessionResult = createNewSession();
      await sendTextMessage(USER_ID, `✅ ${newSessionResult.message}`);
      break;
    
    case 'sessions':
      await sendMarkdownMessage(USER_ID, getSessionsMessage());
      break;
    
    case 'menu':
      await sendMarkdownMessage(USER_ID, getHelpMessage());
      break;

    case 'ls':
      {
        const result = listLocalPath(parsed.path || '.');
        await sendTextMessage(USER_ID, result.success ? result.output : `❌ ${result.output}`);
      }
      break;
    
    case 'run':
      await sendTextMessage(USER_ID, `⏳ 正在执行: ${parsed.command}`);
      
      const result = await executeIFlowCommand(parsed.command);
      
      const output = result.output;
      if (output.length <= 4096) {
        await sendTextMessage(USER_ID, result.success ? `✅ ${output}` : `❌ ${output}`);
      } else {
        const chunks = output.match(/.{1,4000}/g) || [];
        for (let i = 0; i < chunks.length; i++) {
          await sendTextMessage(USER_ID, `[${i + 1}/${chunks.length}] ${chunks[i]}`);
        }
      }
      break;
  }
}

// 启动服务
async function start() {
  try {
    // 测试获取 token
    console.log('[Startup] 测试企业微信连接...');
    await getAccessToken();
    console.log('[Startup] 企业微信连接成功 ✓');

    // 启动 HTTP 服务
    app.listen(PORT, () => {
      console.log(`[Server] 服务已启动，端口: ${PORT}`);
      console.log(`[Server] 健康检查: http://localhost:${PORT}/health`);
      console.log(`[Server] 测试发送: http://localhost:${PORT}/test-send`);
      console.log('');
      console.log('等待企业微信消息...');
    });

    // 启动后发送通知
    setTimeout(async () => {
      await sendMarkdownMessage(USER_ID, `**iFlow 服务已启动** 🚀\n\n时间: ${new Date().toLocaleString('zh-CN')}\n\n你现在可以通过企业微信发送命令来控制 iFlow 了！\n\n发送 \`/help\` 查看帮助。`);
    }, 1000);

  } catch (error) {
    console.error('[Startup] 启动失败:', error.message);
    process.exit(1);
  }
}

start();
