import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, realpathSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'iflow.log');

// iFlow session 瀛樺偍璺緞
const IFLOW_DIR = join(homedir(), '.iflow');
const SESSION_DIR = join(
  IFLOW_DIR,
  'projects',
  process.cwd().replace(/[\\/:\s]/g, '-')
);

function parseBooleanEnv(value) {
  if (value === undefined || value === null) return undefined;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return undefined;
}

function getIflowExtraArgs() {
  const extra = [];

  const allFiles = parseBooleanEnv(process.env.IFLOW_ALL_FILES);
  if (allFiles === true) {
    extra.push('--all-files');
  }

  const sandbox = parseBooleanEnv(process.env.IFLOW_SANDBOX);
  if (sandbox === true) {
    extra.push('--sandbox');
  } else if (sandbox === false) {
    extra.push('--sandbox=false');
  }

  const yolo = parseBooleanEnv(process.env.IFLOW_YOLO);
  if (yolo === true) {
    extra.push('--yolo');
  }

  const includeDirsRaw = process.env.IFLOW_INCLUDE_DIRECTORIES;
  if (includeDirsRaw) {
    const includeDirs = includeDirsRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .join(',');
    if (includeDirs) {
      extra.push('--include-directories', includeDirs);
    }
  }

  return extra;
}

function getPromptPrefix() {
  return process.env.IFLOW_PROMPT_PREFIX || '';
}

function buildPrompt(command) {
  const prefix = getPromptPrefix().trim();
  if (!prefix) {
    return command;
  }
  return `${prefix}\n${command}`;
}

function extractSessionId(output) {
  if (!output) return null;
  const match = output.match(/"session-id"\s*:\s*"session-([^"]+)"/i);
  return match ? match[1] : null;
}

function markSessionActive(sessionId) {
  if (!sessionId) return;
  currentSessionId = sessionId;
  sessionStartTime = new Date();
}

function getLocalAllowlist() {
  const raw = process.env.IFLOW_LOCAL_ALLOWLIST || '';
  const list = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => resolve(p));
  return list;
}

function isPathAllowed(targetPath, allowlist) {
  if (!allowlist || allowlist.length === 0) return false;
  const resolved = resolve(targetPath);
  let realTarget = resolved;
  try {
    realTarget = realpathSync(resolved);
  } catch (_) {
    // ignore, keep resolved
  }
  return allowlist.some(base => {
    const rel = relative(base, realTarget);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
  });
}

function normalizeLocalPath(pathArg = '.') {
  return resolve(pathArg.replace(/^['"]|['"]$/g, ''));
}

function ensurePathAllowed(targetPath) {
  const allowlist = getLocalAllowlist();
  if (allowlist.length === 0) {
    return {
      ok: false,
      message: '未配置本地访问白名单，请设置 IFLOW_LOCAL_ALLOWLIST'
    };
  }

  if (!isPathAllowed(targetPath, allowlist)) {
    return {
      ok: false,
      message: `路径未被允许访问：${targetPath}`
    };
  }

  return { ok: true };
}

function parseQuotedArgs(input = '') {
  const result = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    result.push(match[1] ?? match[2] ?? match[3]);
  }
  return result;
}

function parsePathAndInstruction(text = '') {
  const trimmed = text.trim();
  if (!trimmed) {
    return { path: '', instruction: '' };
  }

  const quoted = trimmed.match(/^"([^"]+)"(?:\s*[:：]\s*|\s+)?([\s\S]*)$/);
  if (quoted) {
    return { path: quoted[1], instruction: (quoted[2] || '').trim() };
  }

  const singleQuoted = trimmed.match(/^'([^']+)'(?:\s*[:：]\s*|\s+)?([\s\S]*)$/);
  if (singleQuoted) {
    return { path: singleQuoted[1], instruction: (singleQuoted[2] || '').trim() };
  }

  const byColon = trimmed.match(/^(.+?)(?:\s*[:：]\s*)([\s\S]+)$/);
  if (byColon) {
    return { path: byColon[1].trim(), instruction: byColon[2].trim() };
  }

  const bySpace = trimmed.match(/^(\S+)\s+([\s\S]+)$/);
  if (bySpace) {
    return { path: bySpace[1].trim(), instruction: bySpace[2].trim() };
  }

  return { path: trimmed, instruction: '' };
}

export function listLocalPath(pathArg = '.') {
  const allowlist = getLocalAllowlist();
  if (allowlist.length === 0) {
    return {
      success: false,
      output: '鏈厤缃湰鍦拌闂櫧鍚嶅崟锛岃璁剧疆 IFLOW_LOCAL_ALLOWLIST锛堥€楀彿鍒嗛殧鐨勭粷瀵硅矾寰勶級'
    };
  }

  const target = resolve(pathArg);
  if (!isPathAllowed(target, allowlist)) {
    return {
      success: false,
      output: `路径未被允许访问：${target}\n请将路径加入 IFLOW_LOCAL_ALLOWLIST`
    };
  }

  try {
    const stat = statSync(target);
    if (stat.isFile()) {
      return { success: true, output: `鏂囦欢: ${target} (${stat.size} bytes)` };
    }

    if (!stat.isDirectory()) {
      return { success: false, output: `不支持的路径类型：${target}` };
    }

    const entries = readdirSync(target);
    const max = 200;
    const shown = entries.slice(0, max);
    const lines = shown.map(name => {
      const p = join(target, name);
      try {
        const s = statSync(p);
        return s.isDirectory() ? `${name}/` : name;
      } catch (_) {
        return name;
      }
    });

    const suffix = entries.length > max ? `\n... 共 ${entries.length} 项，仅显示前 ${max} 项` : '';
    return { success: true, output: lines.join('\n') + suffix };
  } catch (e) {
    return { success: false, output: `读取失败：${e.message}` };
  }
}

export function readLocalTextFile(pathArg, maxChars = 12000) {
  const target = normalizeLocalPath(pathArg);
  const allowed = ensurePathAllowed(target);
  if (!allowed.ok) {
    return { success: false, output: allowed.message };
  }

  try {
    const stat = statSync(target);
    if (!stat.isFile()) {
      return { success: false, output: `目标不是文件：${target}` };
    }

    const content = readFileSync(target, 'utf8');
    const truncated = content.length > maxChars;
    const output = truncated ? `${content.slice(0, maxChars)}\n\n[内容过长，已截断]` : content;
    return { success: true, output, path: target, truncated };
  } catch (e) {
    return { success: false, output: `读取文件失败：${e.message}` };
  }
}

export function openLocalPath(pathArg) {
  const target = normalizeLocalPath(pathArg);
  const allowed = ensurePathAllowed(target);
  if (!allowed.ok) {
    return Promise.resolve({ success: false, output: allowed.message });
  }

  return new Promise((resolve) => {
    const child = spawn('cmd', ['/c', 'start', '', target], {
      shell: false,
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error) => {
      resolve({ success: false, output: `打开失败：${error.message}` });
    });

    child.unref();
    resolve({ success: true, output: `已在电脑上打开：${target}` });
  });
}

export function executeLocalScript(commandLine) {
  const args = parseQuotedArgs(commandLine);
  if (args.length < 2) {
    return Promise.resolve({
      success: false,
      output: '执行脚本至少需要解释器和脚本路径，例如：python path/to/script.py'
    });
  }

  const runtime = args[0].toLowerCase();
  const allowedRuntimes = new Set(['python', 'py', 'node']);
  if (!allowedRuntimes.has(runtime)) {
    return Promise.resolve({
      success: false,
      output: '当前仅支持 python、py、node 三种脚本执行'
    });
  }

  const scriptPath = normalizeLocalPath(args[1]);
  const allowed = ensurePathAllowed(scriptPath);
  if (!allowed.ok) {
    return Promise.resolve({ success: false, output: allowed.message });
  }

  return new Promise((resolve) => {
    const child = spawn(args[0], [scriptPath, ...args.slice(2)], {
      shell: false,
      timeout: 300000
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (code === 0) {
        resolve({
          success: true,
          output: output || `脚本执行完成：${scriptPath}`
        });
      } else {
        resolve({
          success: false,
          output: output || `脚本执行失败，退出码：${code}`
        });
      }
    });

    child.on('error', (error) => {
      resolve({ success: false, output: `启动脚本失败：${error.message}` });
    });
  });
}

async function runIflowFileTask(filePath, instruction, { save = false } = {}) {
  const fileResult = readLocalTextFile(filePath, 16000);
  if (!fileResult.success) {
    return fileResult;
  }

  const prompt = [
    `目标文件：${fileResult.path}`,
    save
      ? '请根据下面要求修改该文件内容，并只返回修改后的完整文件内容，不要加解释，不要加代码块围栏。'
      : '请根据下面要求整理该文件内容，并直接返回整理后的结果。',
    `要求：${instruction || (save ? '优化并整理内容' : '整理内容')}`,
    '',
    '文件内容如下：',
    fileResult.output
  ].join('\n');

  const result = await executeIFlowCommand(prompt);
  if (!result.success) {
    return result;
  }

  if (!save) {
    return result;
  }

  try {
    writeFileSync(fileResult.path, result.output, 'utf8');
    return {
      success: true,
      output: `已写回文件：${fileResult.path}\n\n${result.output.slice(0, 4000)}`
    };
  } catch (e) {
    return { success: false, output: `写回文件失败：${e.message}` };
  }
}

export async function executeAutomationCommand(parsed) {
  switch (parsed.type) {
    case 'exec':
      return await executeLocalScript(parsed.command);
    case 'open_path':
      return await openLocalPath(parsed.path);
    case 'read_file':
      return readLocalTextFile(parsed.path);
    case 'organize_file':
      return await runIflowFileTask(parsed.path, parsed.instruction, { save: false });
    case 'modify_file':
      return await runIflowFileTask(parsed.path, parsed.instruction, { save: true });
    default:
      return { success: false, output: '不支持的自动化命令' };
  }
}

// 褰撳墠浼氳瘽鐘舵€?
let currentSessionId = null;
let sessionStartTime = null;

// 纭繚鏃ュ織鐩綍瀛樺湪
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 鍐欏叆鏃ュ織鏂囦欢
 */
function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch (e) {
    // 蹇界暐鍐欏叆閿欒
  }
}

/**
 * 鑾峰彇鏈€鏂扮殑 session 鏂囦欢
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
        // 浠庢枃浠跺悕鎻愬彇 session ID: session-xxx.jsonl
        const id = f.replace('session-', '').replace('.jsonl', '');
        return { id, path: filePath, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    
    return files.length > 0 ? files[0] : null;
  } catch (e) {
    console.error('[Session] 鑾峰彇鏈€鏂?session 澶辫触:', e.message);
    return null;
  }
}

/**
 * 鑾峰彇鎵€鏈?session 鍒楄〃
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
    console.error('[Session] 鑾峰彇 session 鍒楄〃澶辫触:', e.message);
    return [];
  }
}

/**
 * 鍒犻櫎鎸囧畾 session
 * @param {string} sessionId 
 * @returns {boolean}
 */
function deleteSession(sessionId) {
  try {
    const sessionPath = join(SESSION_DIR, `session-${sessionId}.jsonl`);
    if (existsSync(sessionPath)) {
      unlinkSync(sessionPath);
      console.log(`[Session] 宸插垹闄?session: ${sessionId}`);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Session] 鍒犻櫎 session 澶辫触:', e.message);
    return false;
  }
}

/**
 * 鍒涘缓鏂颁細璇濓紙閲嶇疆褰撳墠 session 鐘舵€侊級
 */
function createNewSession() {
  currentSessionId = null;
  sessionStartTime = new Date();
  console.log('[Session] 寮€濮嬫柊浼氳瘽');
  return { success: true, message: '已开始新会话，下次命令将从空白上下文开始' };
}

/**
 * 鑾峰彇褰撳墠浼氳瘽淇℃伅
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
 * 娓呯悊杈撳嚭锛岀Щ闄よ皟璇曞拰璀﹀憡淇℃伅
 */
function cleanOutput(output) {
  let cleaned = output;
  
  // 绉婚櫎 DeprecationWarning 鐩稿叧鍐呭锛堝寘鎷琛岋級
  cleaned = cleaned.replace(/\(node:\d+\)[\s\S]*?created\)\s*/gi, '');
  
  // 绉婚櫎 <Execution Info> 鍧楋紙鍖呮嫭涓嶅畬鏁寸殑锛?
  cleaned = cleaned.replace(/<Execution Info>[\s\S]*/gi, '');
  
  // 绉婚櫎鍗曠嫭鐨?"閿欒:" 琛岋紙濡傛灉鍙槸璀﹀憡锛?
  cleaned = cleaned.replace(/^\s*閿欒:\s*$/gm, '');
  
  // 绉婚櫎 JSON 鏍煎紡鐨勬墽琛屼俊鎭紙鍙兘娈嬬暀锛?
  cleaned = cleaned.replace(/\{[\s\S]*?"session-id"[\s\S]*?\}\s*/gi, '');
  cleaned = cleaned.replace(/\{[\s\S]*?"tokenUsage"[\s\S]*?\}\s*/gi, '');
  
  // 绉婚櫎寮€澶寸殑 "閿欒: " 濡傛灉鍚庨潰娌℃湁瀹為檯閿欒鍐呭
  cleaned = cleaned.replace(/^閿欒:\s*\n/g, '');
  
  // 绉婚櫎鏈熬鍙兘娈嬬暀鐨勫崟涓嫭鍙锋垨鏍囩
  cleaned = cleaned.replace(/\(\s*$/g, '');
  cleaned = cleaned.replace(/<\/?Execution\s*$/gi, '');
  
  // 绉婚櫎澶氫綑鐨勭┖琛岋紙瓒呰繃2涓繛缁┖琛岋級
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 绉婚櫎寮€澶寸殑绌鸿
  cleaned = cleaned.replace(/^\n+/, '');
  
  // 绉婚櫎鏈熬鐨勭┖琛?
  cleaned = cleaned.replace(/\n+$/, '');
  
  return cleaned;
}

/**
 * 鎵ц iFlow CLI 鍛戒护
 * @param {string} command - 瑕佹墽琛岀殑鍛戒护
 * @param {number} timeout - 瓒呮椂鏃堕棿锛堟绉掞級
 * @param {boolean} resume - 鏄惁鎭㈠涓婃浼氳瘽
 * @returns {Promise<{success: boolean, output: string}>}
 */
export function executeIFlowCommand(command, timeout = 120000, resume = true) {
  return new Promise((resolve) => {
    // 鏋勫缓鍙傛暟
    const args = [];
    args.push(...getIflowExtraArgs());
    
    // 濡傛灉鍚敤鎭㈠浼氳瘽涓斿綋鍓嶆病鏈夋寚瀹?session锛屾鏌ユ槸鍚︽湁鍙仮澶嶇殑 session
    if (resume) {
      if (currentSessionId) {
        args.push('-r', currentSessionId);
        console.log(`[iFlow] 恢复当前会话: ${currentSessionId}`);
      } else {
        const latestSession = getLatestSession();
        if (latestSession) {
          args.push('-r', latestSession.id);
          console.log(`[iFlow] 恢复最近会话: ${latestSession.id}`);
          markSessionActive(latestSession.id);
          sessionStartTime = latestSession.mtime;
        } else {
          args.push('-c');
          console.log('[iFlow] 使用 --continue 恢复最近会话');
        }
      }
    }

    args.push('-p', buildPrompt(command));
    
    console.log(`[iFlow] 鎵ц鍛戒护: iflow ${args.join(' ')}`);
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
      const sessionId = extractSessionId(fullOutput);
      if (sessionId) {
        markSessionActive(sessionId);
      }

      // 鍐欏叆瀹屾暣杈撳嚭鍒版棩蹇?
      writeLog(`OUTPUT (exit code ${code}):\n${fullOutput}`);
      
      if (code === 0 || code === null) {
        console.log(`[iFlow] 鍛戒护鎵ц鎴愬姛`);
        resolve({
          success: true,
          output: cleanedOutput || '鍛戒护鎵ц瀹屾垚'
        });
      } else {
        console.log(`[iFlow] 鍛戒护鎵ц澶辫触锛岄€€鍑虹爜: ${code}`);
        resolve({
          success: false,
          output: cleanedOutput || `鍛戒护鎵ц澶辫触锛岄€€鍑虹爜: ${code}`
        });
      }
    });

    child.on('error', (error) => {
      console.error(`[iFlow] 鎵ц閿欒:`, error.message);
      writeLog(`ERROR: ${error.message}`);
      resolve({
        success: false,
        output: `鎵ц閿欒: ${error.message}`
      });
    });
  });
}

/**
 * 瑙ｆ瀽鐢ㄦ埛娑堟伅锛屾彁鍙栧懡浠?
 * @param {string} message - 鐢ㄦ埛鍙戦€佺殑娑堟伅
 * @returns {{valid: boolean, command: string, args: string[]}}
 */
export function parseCommand(message) {
  // 鏀寔鐨勫懡浠ゆ牸寮忥細
  // /run <鍛戒护>  - 鎵ц iFlow 鍛戒护
  // /new - 寮€濮嬫柊浼氳瘽
  // /ls [path] - 鍒楀嚭鏈湴鏂囦欢/鏂囦欢澶?  // /menu - 鏄剧ず蹇嵎鑿滃崟锛堥涔︼級
  // /sessions - 鏌ョ湅鍘嗗彶浼氳瘽
  // /help - 鏄剧ず甯姪
  // /status - 鏌ョ湅鐘舵€?  
  const trimmed = message.trim();
  
  if (trimmed.startsWith('/run ')) {
    const cmd = trimmed.slice(5).trim();
    return { valid: true, type: 'run', command: cmd };
  }

  if (trimmed.startsWith('/exec ')) {
    return { valid: true, type: 'exec', command: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith('/open ')) {
    return { valid: true, type: 'open_path', path: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith('/read ')) {
    return { valid: true, type: 'read_file', path: trimmed.slice(6).trim() };
  }
  
  if (trimmed === '/new') {
    return { valid: true, type: 'new' };
  }

  if (trimmed === '/menu') {
    return { valid: true, type: 'menu' };
  }

  if (trimmed === '/ls') {
    return { valid: true, type: 'ls', path: '.' };
  }

  if (trimmed.startsWith('/ls ')) {
    const p = trimmed.slice(4).trim();
    return { valid: true, type: 'ls', path: p || '.' };
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

  let match = trimmed.match(/^执行\s+(python|py|node)\s+(.+)$/i);
  if (match) {
    return { valid: true, type: 'exec', command: `${match[1]} ${match[2]}` };
  }

  match = trimmed.match(/^打开(?:文件|目录|文件夹)?\s+(.+)$/);
  if (match) {
    return { valid: true, type: 'open_path', path: match[1].trim() };
  }

  match = trimmed.match(/^(?:读取|查看|显示)文件\s+(.+)$/);
  if (match) {
    return { valid: true, type: 'read_file', path: match[1].trim() };
  }

  match = trimmed.match(/^整理文件(?:内容)?\s+(.+)$/);
  if (match) {
    const { path, instruction } = parsePathAndInstruction(match[1]);
    return { valid: true, type: 'organize_file', path, instruction };
  }

  match = trimmed.match(/^修改文件\s+(.+)$/);
  if (match) {
    const { path, instruction } = parsePathAndInstruction(match[1]);
    return { valid: true, type: 'modify_file', path, instruction };
  }

  // 鐩存帴鍙戦€佸懡浠わ紙涓嶅甫鍓嶇紑锛?
  if (trimmed && !trimmed.startsWith('/')) {
    return { valid: true, type: 'run', command: trimmed };
  }

  return { valid: false, type: 'unknown' };
}

/**
 * 鑾峰彇甯姪淇℃伅
 */
export function getHelpMessage() {
  return `**iFlow 浼佷笟寰俊鍔╂墜** 馃

*鏀寔杩炵画瀵硅瘽锛岃嚜鍔ㄤ繚鎸佷笂涓嬫枃*

鍙敤鍛戒护锛?- 鐩存帴鍙戦€佹秷鎭細鎵ц iFlow 鍛戒护锛堣嚜鍔ㄦ仮澶嶄笂娆′細璇濓級
- \`/run <鍛戒护>\`锛氭墽琛?iFlow 鍛戒护
- \`/menu\`锛氭樉绀哄揩鎹疯彍鍗曪紙椋炰功锛?- \`/ls [path]\`锛氬垪鍑烘湰鍦拌矾寰勫唴瀹癸紙闇€閰嶇疆鐧藉悕鍗曪級
- \`/new\`锛氬紑濮嬫柊浼氳瘽锛堟竻闄や笂涓嬫枃锛?- \`/sessions\`锛氭煡鐪嬪巻鍙蹭細璇?
- \`/status\`锛氭煡鐪嬫湇鍔＄姸鎬?
- \`/help\`锛氭樉绀烘甯姪

馃挕 鎻愮ず锛氶粯璁や細鑷姩鎭㈠鏈€杩戠殑浼氳瘽锛屼繚鎸佸璇濊繛缁€с€傚闇€閲嶆柊寮€濮嬶紝璇蜂娇鐢?\`/new\` 鍛戒护銆?

绀轰緥锛?
\`\`\`
甯垜鍐欎竴涓?Python 鑴氭湰
鍐嶅府鎴戞坊鍔犱竴涓嚱鏁?
缁х画瀹屽杽杩欎釜鑴氭湰
\`\`\`
`;
}

/**
 * 鑾峰彇鐘舵€佷俊鎭?
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
  
  return `**iFlow 服务状态**

- 运行时间: ${hours}小时${minutes}分钟
- 内存使用: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
- 进程 ID: ${process.pid}
- 当前会话: ${sessionStatus}
`;
}

/**
 * 鑾峰彇浼氳瘽鍒楄〃淇℃伅
 */
export function getSessionsMessage() {
  const sessions = getAllSessions();
  
  if (sessions.length === 0) {
    return `**鍘嗗彶浼氳瘽** 馃搵

鏆傛棤鍘嗗彶浼氳瘽璁板綍`;
  }
  
  let message = `**鍘嗗彶浼氳瘽** 馃搵

鍏?${sessions.length} 涓細璇濓細

`;
  
  sessions.slice(0, 10).forEach((session, index) => {
    const time = new Date(session.mtime).toLocaleString('zh-CN');
    const sizeKB = Math.round(session.size / 1024);
    const current = session.id === currentSessionId ? ' 鉁?褰撳墠' : '';
    message += `${index + 1}. \`${session.id.substring(0, 8)}...\` - ${time} (${sizeKB}KB)${current}\n`;
  });
  
  if (sessions.length > 10) {
    message += `\n_...杩樻湁 ${sessions.length - 10} 涓細璇漘`;
  }
  
  return message;
}

// 瀵煎嚭 session 绠＄悊鍑芥暟
export { createNewSession, getCurrentSessionInfo, getAllSessions, deleteSession };


