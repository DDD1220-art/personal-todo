export function localDate(offset = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function validDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.valueOf()) && localDate(0, d) === value;
}

export function validateDocument(doc) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.tasks) || doc.tasks.length > 3000) throw new Error('待办数据格式不正确，已停止读取，避免覆盖数据。');
  const ids = new Set();
  for (const t of doc.tasks) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 240 || !['work', 'life'].includes(t.space) || typeof t.done !== 'boolean' || typeof t.due !== 'string' || !validDate(t.due) || typeof t.createdAt !== 'string' || Number.isNaN(Date.parse(t.createdAt))) throw new Error('任务数据格式不正确，已停止读取。');
    ids.add(t.id);
  }
  return doc;
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function encodeContent(doc) {
  const bytes = new TextEncoder().encode(JSON.stringify(doc, null, 2) + '\n');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeContent(content) {
  return validateDocument(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0)))));
}

export class GithubStore {
  constructor(config, token = '', request = fetch) {
    if (!/^[a-zA-Z0-9-]+$/.test(config.owner) || !/^[a-zA-Z0-9_.-]+$/.test(config.repo)) throw new Error('请填写正确的 GitHub 用户名和仓库名称。');
    this.config = config;
    this.token = token;
    this.request = request;
    this.endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${config.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  async call(method, body) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.request(this.endpoint + (method === 'GET' ? `?ref=${encodeURIComponent(this.config.branch)}` : ''), { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    } catch {
      throw new Error(method === 'PUT' ? '网络中断，保存结果尚未确认。请先刷新列表核对，再决定是否重试。' : '暂时无法连接 GitHub，请检查网络后刷新重试。');
    }
    if (!response.ok) {
      const messages = { 401: '令牌无效或已过期，请在同步设置中更新。', 403: 'GitHub 拒绝访问：请检查令牌权限或稍后重试。', 404: '找不到仓库或 todo_data.json，请检查仓库名称及令牌授权。', 409: '另一台设备已修改任务。本次未保存，请刷新列表后重新编辑。', 422: 'GitHub 未接受本次更新，请刷新后重试。', 429: '请求过于频繁，请稍后再试。' };
      const error = new Error(messages[response.status] || `GitHub 暂时无法处理请求（${response.status}），请稍后重试。`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async read() {
    const file = await this.call('GET');
    if (file.encoding !== 'base64' || typeof file.sha !== 'string' || typeof file.content !== 'string') throw new Error('无法读取待办文件，文件可能过大。');
    return { doc: decodeContent(file.content), sha: file.sha };
  }
  async write(doc, sha) {
    if (!this.token || !sha) throw new Error('请先连接 GitHub 并读取任务，再保存。');
    validateDocument(doc);
    const content = encodeContent(doc);
    if (content.length > 950000) throw new Error('任务记录已接近容量上限，请先整理已完成任务。');
    const result = await this.call('PUT', { message: 'Update personal tasks', content, sha, branch: this.config.branch });
    if (!result.content?.sha) throw new Error('未取得保存结果，请刷新核对任务。');
    return result.content.sha;
  }
}
