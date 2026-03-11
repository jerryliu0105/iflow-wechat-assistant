import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'iflow.log');

// iFlow session 存储路径
const IFLOW_DIR = join(homedir(), '.iflow');
const SESSION_DIR = join(IFLOW_DIR, 'projects', process.cwd().replace(/\//g, '-'));

// 当前会话状态
let currentSessionId = null;
let sessionStartTime = null;

// 确保日志目录存在
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 写入日志文件
 */
function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch (e) {
    // 忽略写入错误
  }
}

/**
 * 获取最新的 session 文件
 * @returns {{id: string, path: string, mtime: Date} | null}
 */
function getLatestSession() {
  try {
    if (!existsSync(SESSION_DIR)) {
      return null;
    }
    
    const files = readdirSync(SESSION_DIR)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .map(f => {
        const filePath = join(SESSION_DIR, f);
        const stats = statSync(filePath);
        // 从文件名提取 session ID: session-xxx.jsonl
        const id = f.replace('session-', '').replace('.jsonl', '');
        return { id, path: filePath, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    
    return files.length > 0 ? files[0] : null;
  } catch (e) {
    console.error('[Session] 获取最新 session 失败:', e.message);
    return null;
  }
}

/**
 * 获取所有 session 列表
 * @returns {Array<{id: string, mtime: Date, size: number}>}
 */
function getAllSessions() {
  try {
    if (!existsSync(SESSION_DIR)) {
      return [];
    }
    
    return readdirSync(SESSION_DIR)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .map(f => {
        const filePath = join(SESSION_DIR, f);
        const stats = statSync(filePath);
        const id = f.replace('session-', '').replace('.jsonl', '');
        return { 
          id, 
          mtime: stats.mtime, 
          size: stats.size,
          path: filePath 
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    console.error('[Session] 获取 session 列表失败:', e.message);
    return [];
  }
}

/**
 * 删除指定 session
 * @param {string} sessionId 
 * @returns {boolean}
 */
function deleteSession(sessionId) {
  try {
    const sessionPath = join(SESSION_DIR, `session-${sessionId}.jsonl`);
    if (existsSync(sessionPath)) {
      unlinkSync(sessionPath);
      console.log(`[Session] 已删除 session: ${sessionId}`);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Session] 删除 session 失败:', e.message);
    return false;
  }
}

/**
 * 创建新会话（重置当前 session 状态）
 */
function createNewSession() {
  currentSessionId = null;
  sessionStartTime = new Date();
  console.log('[Session] 开始新会话');
  return { success: true, message: '已开始新会话，下次命令将从空白上下文开始' };
}

/**
 * 获取当前会话信息
 */
function getCurrentSessionInfo() {
  if (currentSessionId) {
    return {
      hasSession: true,
      sessionId: currentSessionId,
      startTime: sessionStartTime
    };
  }
  
  const latest = getLatestSession();
  if (latest) {
    return {
      hasSession: true,
      sessionId: latest.id,
      startTime: latest.mtime,
      isRestored: true
    };
  }
  
  return {
    hasSession: false,
    sessionId: null,
    startTime: null
  };
}

/**
 * 清理输出，移除调试和警告信息
 */
function cleanOutput(output) {
  let cleaned = output;
  
  // 移除 DeprecationWarning 相关内容（包括多行）
  cleaned = cleaned.replace(/\(node:\d+\)[\s\S]*?created\)\s*/gi, '');
  
  // 移除 <Execution Info> 块（包括不完整的）
  cleaned = cleaned.replace(/<Execution Info>[\s\S]*/gi, '');
  
  // 移除单独的 "错误:" 行（如果只是警告）
  cleaned = cleaned.replace(/^\s*错误:\s*$/gm, '');
  
  // 移除 JSON 格式的执行信息（可能残留）
  cleaned = cleaned.replace(/\{[\s\S]*?"session-id"[\s\S]*?\}\s*/gi, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"tokenUsage"[\s\S]*?\}\s*/gi, '');
  
  // 移除开头的 "错误: " 如果后面没有实际错误内容
  cleaned = cleaned.replace(/^错误:\s*\n/g, '');
  
  // 移除末尾可能残留的单个括号或标签
  cleaned = cleaned.replace(/\(\s*$/g, '');
  cleaned = cleaned.replace(/<\/?Execution\s*$/gi, '');
  
  // 移除多余的空行（超过2个连续空行）
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 移除开头的空行
  cleaned = cleaned.replace(/^\n+/, '');
  
  // 移除末尾的空行
  cleaned = cleaned.replace(/\n+$/, '');
  
  return cleaned;
}

/**
 * 执行 iFlow CLI 命令
 * @param {string} command - 要执行的命令
 * @param {number} timeout - 超时时间（毫秒）
 * @param {boolean} resume - 是否恢复上次会话
 * @returns {Promise<{success: boolean, output: string}>}
 */
export function executeIFlowCommand(command, timeout = 120000, resume = true) {
  return new Promise((resolve) => {
    // 构建参数
    const args = [];
    
    // 如果启用恢复会话且当前没有指定 session，检查是否有可恢复的 session
    if (resume) {
      const latestSession = getLatestSession();
      if (latestSession) {
        args.push('-r', latestSession.id);
        console.log(`[iFlow] 恢复会话: ${latestSession.id}`);
        if (!currentSessionId) {
          currentSessionId = latestSession.id;
          sessionStartTime = latestSession.mtime;
        }
      }
    }
    
    // 添加命令
    args.push('-p', command);
    
    console.log(`[iFlow] 执行命令: iflow ${args.join(' ')}`);
    writeLog(`COMMAND: iflow ${args.join(' ')}`);
    
    const child = spawn('iflow', args, {
      shell: true,
      timeout: timeout
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      const fullOutput = output + (errorOutput ? `\n${errorOutput}` : '');
      const cleanedOutput = cleanOutput(fullOutput);
      
      // 写入完整输出到日志
      writeLog(`OUTPUT (exit code ${code}):\n${fullOutput}`);
      
      if (code === 0) {
        console.log(`[iFlow] 命令执行成功`);
        resolve({
          success: true,
          output: cleanedOutput || '命令执行完成'
        });
      } else {
        console.log(`[iFlow] 命令执行失败，退出码: ${code}`);
        resolve({
          success: false,
          output: cleanedOutput || `命令执行失败，退出码: ${code}`
        });
      }
    });

    child.on('error', (error) => {
      console.error(`[iFlow] 执行错误:`, error.message);
      writeLog(`ERROR: ${error.message}`);
      resolve({
        success: false,
        output: `执行错误: ${error.message}`
      });
    });
  });
}

/**
 * 解析用户消息，提取命令
 * @param {string} message - 用户发送的消息
 * @returns {{valid: boolean, command: string, args: string[]}}
 */
export function parseCommand(message) {
  // 支持的命令格式：
  // /run <命令>  - 执行 iFlow 命令
  // /new - 开始新会话
  // /sessions - 查看历史会话
  // /help - 显示帮助
  // /status - 查看状态
  
  const trimmed = message.trim();
  
  if (trimmed.startsWith('/run ')) {
    const cmd = trimmed.slice(5).trim();
    return { valid: true, type: 'run', command: cmd };
  }
  
  if (trimmed === '/new') {
    return { valid: true, type: 'new' };
  }
  
  if (trimmed === '/sessions') {
    return { valid: true, type: 'sessions' };
  }
  
  if (trimmed === '/help') {
    return { valid: true, type: 'help' };
  }
  
  if (trimmed === '/status') {
    return { valid: true, type: 'status' };
  }

  // 直接发送命令（不带前缀）
  if (trimmed && !trimmed.startsWith('/')) {
    return { valid: true, type: 'run', command: trimmed };
  }

  return { valid: false, type: 'unknown' };
}

/**
 * 获取帮助信息
 */
export function getHelpMessage() {
  return `**iFlow 企业微信助手** 🤖

*支持连续对话，自动保持上下文*

可用命令：
- 直接发送消息：执行 iFlow 命令（自动恢复上次会话）
- \`/run <命令>\`：执行 iFlow 命令
- \`/new\`：开始新会话（清除上下文）
- \`/sessions\`：查看历史会话
- \`/status\`：查看服务状态
- \`/help\`：显示此帮助

💡 提示：默认会自动恢复最近的会话，保持对话连续性。如需重新开始，请使用 \`/new\` 命令。

示例：
\`\`\`
帮我写一个 Python 脚本
再帮我添加一个函数
继续完善这个脚本
\`\`\`
`;
}

/**
 * 获取状态信息
 */
export async function getStatusMessage() {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  const sessionInfo = getCurrentSessionInfo();
  let sessionStatus = '无活跃会话';
  if (sessionInfo.hasSession) {
    const sessionTime = sessionInfo.startTime ? new Date(sessionInfo.startTime).toLocaleString('zh-CN') : '未知';
    sessionStatus = `${sessionInfo.sessionId.substring(0, 8)}... (${sessionTime})`;
    if (sessionInfo.isRestored) {
      sessionStatus += ' [已恢复]';
    }
  }
  
  return `**iFlow 服务状态** 📊

- 运行时间: ${hours}小时${minutes}分钟
- 内存使用: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
- 进程 ID: ${process.pid}
- 当前会话: ${sessionStatus}
`;
}

/**
 * 获取会话列表信息
 */
export function getSessionsMessage() {
  const sessions = getAllSessions();
  
  if (sessions.length === 0) {
    return `**历史会话** 📋

暂无历史会话记录`;
  }
  
  let message = `**历史会话** 📋

共 ${sessions.length} 个会话：

`;
  
  sessions.slice(0, 10).forEach((session, index) => {
    const time = new Date(session.mtime).toLocaleString('zh-CN');
    const sizeKB = Math.round(session.size / 1024);
    const current = session.id === currentSessionId ? ' ✓ 当前' : '';
    message += `${index + 1}. \`${session.id.substring(0, 8)}...\` - ${time} (${sizeKB}KB)${current}\n`;
  });
  
  if (sessions.length > 10) {
    message += `\n_...还有 ${sessions.length - 10} 个会话_`;
  }
  
  return message;
}

// 导出 session 管理函数
export { createNewSession, getCurrentSessionInfo, getAllSessions, deleteSession };
