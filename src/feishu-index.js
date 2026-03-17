import 'dotenv/config';
import lark from '@larksuiteoapi/node-sdk';
import { sendTextMessage, sendMarkdownMessage, sendMenuCard, getClient } from './feishu.js';
import { executeIFlowCommand, executeAutomationCommand, parseCommand, getHelpMessage, getStatusMessage, getSessionsMessage, createNewSession, listLocalPath } from './iflow.js';

// 飞书应用配置
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

// 用于记录已处理的消息 ID，防止重复处理
const processedMessages = new Set();
const MAX_PROCESSED_CACHE = 1000;

/**
 * 清理已处理消息缓存，防止内存泄漏
 */
function cleanProcessedCache() {
  if (processedMessages.size > MAX_PROCESSED_CACHE) {
    const entries = [...processedMessages];
    const toRemove = entries.slice(0, entries.length - MAX_PROCESSED_CACHE / 2);
    toRemove.forEach(id => processedMessages.delete(id));
    console.log(`[Cache] 已清理 ${toRemove.length} 条消息缓存`);
  }
}

/**
 * 处理收到的消息事件
 * @param {object} data - 飞书事件数据
 */
async function handleMessageEvent(data) {
  try {
    const message = data.message;
    const messageId = message.message_id;

    // 去重：防止同一消息被重复处理
    if (processedMessages.has(messageId)) {
      console.log(`[Event] 消息已处理，跳过: ${messageId}`);
      return;
    }
    processedMessages.add(messageId);
    cleanProcessedCache();

    // 获取发送者 open_id
    const senderOpenId = data.sender?.sender_id?.open_id;
    if (!senderOpenId) {
      console.error('[Event] 无法获取发送者 open_id');
      return;
    }

    // 只处理文本消息
    const msgType = message.message_type;
    if (msgType !== 'text') {
      console.log(`[Event] 忽略非文本消息: ${msgType}`);
      return;
    }

    // 解析消息内容
    let content = '';
    try {
      const contentObj = JSON.parse(message.content);
      content = contentObj.text || '';
    } catch (e) {
      console.error('[Event] 解析消息内容失败:', e.message);
      return;
    }

    // 去掉 @机器人 的文本（飞书消息中 @ 的格式为 @_user_xxx）
    content = content.replace(/@_user_\w+/g, '').trim();

    if (!content) {
      return;
    }

    console.log(`[Event] 收到消息: ${content} (来自: ${senderOpenId})`);

    // 异步处理命令
    await processCommand(content, senderOpenId);
  } catch (error) {
    console.error('[Event] 处理消息事件错误:', error);
  }
}

/**
 * 处理卡片按钮事件
 * @param {object} data - 飞书卡片事件数据
 */
async function handleCardActionEvent(data) {
  try {
    const rawValue = data?.action?.value;
    let valueObj = rawValue;
    if (typeof rawValue === 'string') {
      try {
        valueObj = JSON.parse(rawValue);
      } catch (_) {
        valueObj = { cmd: rawValue };
      }
    }
    const cmd = valueObj?.cmd || valueObj?.command;
    if (!cmd) {
      console.warn('[Card] 缺少 cmd，raw value:', rawValue);
      return { code: 0 };
    }

    const openId =
      data?.operator?.open_id ||
      data?.user?.open_id ||
      data?.action?.user_id?.open_id ||
      data?.open_id ||
      data?.context?.open_id;

    if (!openId) {
      console.error('[Card] 无法获取 open_id，data keys:', Object.keys(data || {}));
      return { code: 0 };
    }

    await processCommand(cmd, openId);
    return { code: 0 };
  } catch (error) {
    console.error('[Card] 处理卡片事件失败:', error.message);
    return { code: 0 };
  }
}

/**
 * 处理命令
 * @param {string} content - 用户发送的文本
 * @param {string} openId - 发送者的 open_id
 */
async function processCommand(content, openId) {
  const parsed = parseCommand(content);

  if (!parsed.valid) {
    await sendTextMessage(openId, '无法识别的命令，发送 /help 查看帮助');
    return;
  }

  switch (parsed.type) {
    case 'help':
      await sendMarkdownMessage(openId, getHelpMessage());
      break;

    case 'status':
      await sendMarkdownMessage(openId, await getStatusMessage());
      break;

    case 'new':
      const newSessionResult = createNewSession();
      await sendTextMessage(openId, `✅ ${newSessionResult.message}`);
      break;

    case 'sessions':
      await sendMarkdownMessage(openId, getSessionsMessage());
      break;
    
    case 'menu':
      await sendMenuCard(openId);
      break;

    case 'ls':
      {
        const result = listLocalPath(parsed.path || '.');
        await sendTextMessage(openId, result.success ? result.output : `❌ ${result.output}`);
      }
      break;

    case 'exec':
    case 'open_path':
    case 'read_file':
    case 'organize_file':
    case 'modify_file':
      {
        const actionResult = await executeAutomationCommand(parsed);
        await sendTextMessage(openId, actionResult.success ? actionResult.output : `鉂?${actionResult.output}`);
      }
      break;

    case 'run':
      await sendTextMessage(openId, `⏳ 正在执行: ${parsed.command}`);

      const result = await executeIFlowCommand(parsed.command);

      const output = result.output;
      if (output.length <= 4096) {
        await sendTextMessage(openId, result.success ? `✅ ${output}` : `❌ ${output}`);
      } else {
        // 长消息分片发送
        const chunks = output.match(/.{1,4000}/gs) || [];
        for (let i = 0; i < chunks.length; i++) {
          await sendTextMessage(openId, `[${i + 1}/${chunks.length}] ${chunks[i]}`);
        }
      }
      break;
  }
}

/**
 * 启动飞书机器人服务
 */
async function start() {
  console.log('[Startup] 正在启动飞书 iFlow 助手...');

  // 校验配置
  if (!APP_ID || !APP_SECRET) {
    console.error('[Startup] 缺少飞书应用配置！请在 .env 中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    process.exit(1);
  }

  try {
    // 创建事件分发器
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await handleMessageEvent(data);
      },
      'card.action': async (data) => {
        return await handleCardActionEvent(data);
      },
    });

    // 创建 WebSocket 客户端（长连接模式）
    const wsClient = new lark.WSClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      loggerLevel: lark.LoggerLevel.INFO,
    });

    // 启动长连接（eventDispatcher 需要传给 start 方法）
    await wsClient.start({ eventDispatcher });
    console.log('[Startup] 飞书长连接已建立 ✓');
    console.log('[Startup] 等待飞书消息...');
    console.log('');

    // 注意：长连接模式下无法在启动时自动发送通知
    // 因为我们不知道用户的 open_id，需要用户先发一条消息
    console.log('[提示] 请在飞书中找到你的机器人并发送消息来开始使用。');

  } catch (error) {
    console.error('[Startup] 启动失败:', error.message);
    process.exit(1);
  }
}

start();
