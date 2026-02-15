import axios from 'axios';

// 企业微信 API 配置
const CORP_ID = process.env.CORP_ID;
const SECRET = process.env.SECRET;
const AGENT_ID = process.env.AGENT_ID;

// Token 缓存
let accessToken = null;
let tokenExpireTime = 0;

/**
 * 获取 access_token
 */
export async function getAccessToken() {
  // 如果 token 有效，直接返回
  if (accessToken && Date.now() < tokenExpireTime) {
    return accessToken;
  }

  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken`,
      {
        params: {
          corpid: CORP_ID,
          corpsecret: SECRET
        }
      }
    );

    if (response.data.errcode === 0) {
      accessToken = response.data.access_token;
      // 提前 5 分钟过期
      tokenExpireTime = Date.now() + (response.data.expires_in - 300) * 1000;
      console.log('[Token] 获取 access_token 成功');
      return accessToken;
    } else {
      throw new Error(`获取 token 失败: ${response.data.errmsg}`);
    }
  } catch (error) {
    console.error('[Token] 获取 access_token 失败:', error.message);
    throw error;
  }
}

/**
 * 发送文本消息
 * @param {string} userId - 接收消息的用户 ID
 * @param {string} content - 消息内容
 */
export async function sendTextMessage(userId, content) {
  const token = await getAccessToken();

  try {
    const response = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        touser: userId,
        msgtype: 'text',
        agentid: parseInt(AGENT_ID),
        text: {
          content: content
        },
        safe: 0
      }
    );

    if (response.data.errcode === 0) {
      console.log(`[Message] 消息发送成功 -> ${userId}`);
      return true;
    } else {
      console.error('[Message] 消息发送失败:', response.data.errmsg);
      return false;
    }
  } catch (error) {
    console.error('[Message] 发送消息异常:', error.message);
    return false;
  }
}

/**
 * 发送 Markdown 消息
 * @param {string} userId - 接收消息的用户 ID
 * @param {string} content - Markdown 内容
 */
export async function sendMarkdownMessage(userId, content) {
  const token = await getAccessToken();

  try {
    const response = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        touser: userId,
        msgtype: 'markdown',
        agentid: parseInt(AGENT_ID),
        markdown: {
          content: content
        }
      }
    );

    if (response.data.errcode === 0) {
      console.log(`[Message] Markdown 消息发送成功 -> ${userId}`);
      return true;
    } else {
      console.error('[Message] 消息发送失败:', response.data.errmsg);
      return false;
    }
  } catch (error) {
    console.error('[Message] 发送消息异常:', error.message);
    return false;
  }
}
