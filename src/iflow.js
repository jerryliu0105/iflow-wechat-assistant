import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'iflow.log');

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
 * @returns {Promise<{success: boolean, output: string}>}
 */
export function executeIFlowCommand(command, timeout = 60000) {
  return new Promise((resolve) => {
    console.log(`[iFlow] 执行命令: iflow ${command}`);
    writeLog(`COMMAND: ${command}`);
    
    const child = spawn('iflow', [command], {
      shell: false,
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
  // /help - 显示帮助
  // /status - 查看状态
  
  const trimmed = message.trim();
  
  if (trimmed.startsWith('/run ')) {
    const cmd = trimmed.slice(5).trim();
    return { valid: true, type: 'run', command: cmd };
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
  return `**iFlow 企业微信助手**

可用命令：
- 直接发送消息：执行 iFlow 命令
- \`/run <命令>\`：执行 iFlow 命令
- \`/help\`：显示此帮助
- \`/status\`：查看服务状态

示例：
\`\`\`
帮我写一个 Python 脚本
创建一个 README 文件
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
  
  return `**iFlow 服务状态**

- 运行时间: ${hours}小时${minutes}分钟
- 内存使用: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
- 进程 ID: ${process.pid}
`;
}
