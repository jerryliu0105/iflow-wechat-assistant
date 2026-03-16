import lark from '@larksuiteoapi/node-sdk';

// 飞书应用配置
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

// 初始化飞书客户端
const client = new lark.Client({
  appId: APP_ID,
  appSecret: APP_SECRET,
  appType: lark.AppType.SelfBuild,
});

/**
 * 获取飞书客户端实例
 */
export function getClient() {
  return client;
}

/**
 * 发送文本消息
 * @param {string} openId - 接收消息的用户 Open ID
 * @param {string} content - 消息内容
 */
export async function sendTextMessage(openId, content) {
  try {
    const res = await client.im.message.create({
      params: {
        receive_id_type: 'open_id',
      },
      data: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });

    if (res.code === 0) {
      console.log(`[Feishu] 文本消息发送成功 -> ${openId}`);
      return true;
    } else {
      console.error('[Feishu] 消息发送失败:', res.msg);
      return false;
    }
  } catch (error) {
    console.error('[Feishu] 发送消息异常:', error.message);
    return false;
  }
}

/**
 * 发送富文本消息（飞书使用 post 类型实现类似 Markdown 的效果）
 * @param {string} openId - 接收消息的用户 Open ID
 * @param {string} content - Markdown 格式的内容（会转换为飞书富文本）
 */
export async function sendMarkdownMessage(openId, content) {
  try {
    // 将 Markdown 文本转换为飞书富文本格式
    const postContent = markdownToPost(content);

    const res = await client.im.message.create({
      params: {
        receive_id_type: 'open_id',
      },
      data: {
        receive_id: openId,
        msg_type: 'post',
        content: JSON.stringify(postContent),
      },
    });

    if (res.code === 0) {
      console.log(`[Feishu] 富文本消息发送成功 -> ${openId}`);
      return true;
    } else {
      console.error('[Feishu] 消息发送失败:', res.msg);
      return false;
    }
  } catch (error) {
    console.error('[Feishu] 发送消息异常:', error.message);
    return false;
  }
}

/**
 * 发送飞书快捷菜单卡片
 * @param {string} openId - 接收消息的用户 Open ID
 */
export async function sendMenuCard(openId) {
  const card = {
    config: {
      wide_screen_mode: true
    },
    header: {
      title: {
        tag: 'plain_text',
        content: 'iFlow 快捷菜单'
      }
    },
    elements: [
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '帮助 /help' },
            type: 'primary',
            value: { cmd: '/help' }
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '状态 /status' },
            value: { cmd: '/status' }
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '会话 /sessions' },
            value: { cmd: '/sessions' }
          }
        ]
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '新会话 /new' },
            value: { cmd: '/new' }
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '列 E:\\ /ls' },
            value: { cmd: '/ls E:\\' }
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '列 Documents' },
            value: { cmd: '/ls C:\\Users\\Administrator\\Documents' }
          }
        ]
      }
    ]
  };

  try {
    const res = await client.im.message.create({
      params: {
        receive_id_type: 'open_id',
      },
      data: {
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });

    if (res.code === 0) {
      console.log(`[Feishu] 菜单卡片发送成功 -> ${openId}`);
      return true;
    } else {
      console.error('[Feishu] 菜单卡片发送失败', res.msg);
      return false;
    }
  } catch (error) {
    console.error('[Feishu] 发送菜单卡片异常', error.message);
    return false;
  }
}

/**
 * 将简单的 Markdown 文本转换为飞书富文本 (post) 格式
 * 支持: **粗体**, *斜体*, `代码`, 普通文本, 换行分段
 * @param {string} markdown
 * @returns {object} 飞书 post 格式内容
 */
function markdownToPost(markdown) {
  const lines = markdown.split('\n');
  let title = '';
  const contentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 提取标题（第一个 ** 包裹的内容作为标题）
    if (!title) {
      const titleMatch = trimmed.match(/^\*\*(.+?)\*\*/);
      if (titleMatch) {
        title = titleMatch[1];
        // 如果这行只有标题，跳过
        const remaining = trimmed.replace(/^\*\*.+?\*\*\s*/, '').trim();
        if (!remaining) continue;
      }
    }

    // 空行 -> 段落分隔
    if (!trimmed) {
      contentLines.push([{ tag: 'text', text: '' }]);
      continue;
    }

    // 解析行内元素
    const elements = parseInlineElements(trimmed);
    if (elements.length > 0) {
      contentLines.push(elements);
    }
  }

  return {
    zh_cn: {
      title: title || '',
      content: contentLines,
    },
  };
}

/**
 * 解析行内 Markdown 元素
 * @param {string} text
 * @returns {Array} 飞书富文本元素数组
 */
function parseInlineElements(text) {
  const elements = [];
  // 匹配: **bold**, *italic*, `code`, 或普通文本
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // **粗体**
      elements.push({ tag: 'text', text: match[2], style: ['bold'] });
    } else if (match[3]) {
      // *斜体*
      elements.push({ tag: 'text', text: match[3], style: ['italic'] });
    } else if (match[4]) {
      // `代码`
      elements.push({ tag: 'text', text: match[4], style: ['bold'] });
    } else if (match[5]) {
      // 普通文本
      elements.push({ tag: 'text', text: match[5] });
    }
  }

  return elements;
}
