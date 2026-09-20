import { GithubStore, localDate, validDate, sortTasks } from './core.js?v=2';

const $ = id => document.getElementById(id);
const defaults = { ...window.TODO_CONFIG };
const storageKey = 'youxu-github-connection-v1';
const demo = new URLSearchParams(location.search).get('demo') === '1';
let config = { ...defaults }, token = '', store, doc = { version: 1, tasks: [] }, sha = '', space = 'work';
let busy = false, loaded = false, editing = null, editingSha = '', toastTimer, lastFetch = 0;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved?.owner && saved?.repo && typeof saved.token === 'string') {
    config = { ...defaults, owner: saved.owner, repo: saved.repo };
    token = saved.token;
    $('remember').checked = true;
  }
} catch { /* Storage may be unavailable; keep connection in memory. */ }

function status(message) { $('connection').textContent = message; }
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, error ? 9000 : 3000);
}
function lock(value) {
  busy = value;
  document.querySelectorAll('#add-form input, #add-form button, #edit-form input, #edit-form select, #edit-form button, #connect-form input, #connect-form button, #refresh, .check, .edit-task, .task-name').forEach(el => el.disabled = value);
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function taskRow(task) {
  const row = element('div', `task-row${task.done ? ' completed' : ''}`);
  const check = element('button', `check${task.done ? ' checked' : ''}`, task.done ? '✓' : '');
  check.setAttribute('aria-label', `${task.done ? '恢复' : '完成'}：${task.title}`);
  check.setAttribute('aria-pressed', String(task.done));
  check.onclick = () => mutate(tasks => tasks.map(t => t.id === task.id ? { ...t, done: !t.done } : t), task.done ? '已恢复待办' : '完成了一件事');
  const name = element('button', 'task-name', task.title);
  name.onclick = () => openEdit(task);
  const meta = element('div', 'task-meta');
  let dateText = '未设日期', dateClass = 'none';
  if (task.due) {
    dateText = `${Number(task.due.slice(5, 7))}月${Number(task.due.slice(8))}日`;
    if (task.due.slice(0, 4) !== localDate().slice(0, 4)) dateText = task.due.slice(0, 4) + '年' + dateText;
    dateClass = '';
    if (!task.done && task.due < localDate()) { dateText += ' · 已逾期'; dateClass = 'overdue'; }
    else if (task.due === localDate()) { dateText = '今天'; dateClass = task.done ? '' : 'urgent'; }
    else if (task.due === localDate(1)) dateText = '明天';
  }
  meta.append(element('span', `due ${dateClass}`, dateText));
  const edit = element('button', 'edit-task', '···');
  edit.setAttribute('aria-label', `编辑：${task.title}`);
  edit.onclick = () => openEdit(task);
  meta.append(edit);
  row.append(check, name, meta);
  return row;
}
function render() {
  const work = space === 'work';
  document.body.dataset.space = space;
  $('breadcrumb').textContent = work ? '工作' : '生活';
  $('heading').replaceChildren(document.createTextNode(work ? '工作待办' : '生活待办'), element('span', 'heading-dot'));
  $('eyebrow').textContent = work ? 'WORKSPACE / 01' : 'PERSONAL / 02';
  $('emblem').textContent = work ? '▣' : '❋';
  $('subtitle').textContent = work ? '把要做的事记下来，专注眼前这一件。' : '给生活留一点空间，把小事好好安排。';
  document.querySelectorAll('[data-space]').forEach(button => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('active', button.dataset.space === space);
    button.setAttribute('aria-pressed', String(button.dataset.space === space));
  });
  for (const category of ['work', 'life']) $(category + '-count').textContent = doc.tasks.filter(t => t.space === category && !t.done).length;
  const tasks = sortTasks(doc.tasks.filter(t => t.space === space));
  const pending = tasks.filter(t => !t.done), done = tasks.filter(t => t.done);
  $('pending-count').textContent = pending.length;
  $('completed-count').textContent = done.length;
  $('task-list').replaceChildren(...pending.map(taskRow));
  $('completed-list').replaceChildren(...done.map(taskRow));
  if (!pending.length) {
    const empty = element('div', 'empty');
    empty.append(element('span', '', loaded ? '✓' : '↻'), element('p', '', loaded ? (done.length ? '这里的待办都完成了' : '还没有待办，从一件小事开始') : '等待读取任务'), element('p', '', loaded ? '在上方输入名称，按回车即可添加' : '连接成功后会显示你的任务'));
    $('task-list').append(empty);
  }
  $('banner-text').textContent = demo ? '体验模式：这里的操作仅用于预览，不会保存或同步。' : token ? '已连接 GitHub。任务保存在所选仓库，公开仓库内容也会公开。' : '电脑和手机共享一份待办；连接 GitHub 后即可添加和修改。';
  $('account-label').textContent = token ? '已连接 · 设置' : '同步设置';
  lock(busy);
}
function openSettings() {
  $('owner').value = config.owner;
  $('repo').value = config.repo;
  $('token').value = '';
  $('token').placeholder = token ? '重新输入令牌可更新连接' : '仅需所选仓库的 Contents 读写权限';
  $('auth-message').textContent = demo ? '当前是体验模式。请关闭体验链接，回到正式页面后连接。' : '';
  $('account-dialog').showModal();
}
async function refresh(quiet = false) {
  if (busy || demo || $('edit-dialog').open) return;
  lock(true);
  status('正在同步…');
  try {
    const result = await store.read();
    doc = result.doc; sha = result.sha; loaded = true; lastFetch = Date.now();
    status(token ? 'GitHub · 已同步' : 'GitHub · 只读');
    $('last-sync').textContent = '上次同步 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    status('同步失败 · 点击刷新重试');
    if (!quiet || !loaded) toast(error.message, true);
  } finally { lock(false); render(); }
}
async function mutate(update, message, expectedSha = sha) {
  if (busy) return false;
  if (!demo && !token) { openSettings(); return false; }
  if (!loaded) { toast('请先刷新并成功读取云端任务。', true); return false; }
  if (expectedSha !== sha) { toast('任务已更新，请关闭详情并重新编辑。', true); return false; }
  lock(true);
  try {
    const next = { ...doc, tasks: update(doc.tasks.map(t => ({ ...t }))) };
    if (!demo) sha = await store.write(next, expectedSha);
    doc = next;
    status(demo ? '体验模式 · 不会保存' : 'GitHub · 已同步');
    toast(message);
    return true;
  } catch (error) {
    status('未确认保存 · 请刷新核对');
    toast(error.message, true);
    return false;
  } finally { lock(false); render(); }
}
function openEdit(task) {
  if (busy) return;
  editing = task.id; editingSha = sha;
  $('edit-title').value = task.title;
  $('edit-date').value = task.due;
  $('edit-space').value = task.space;
  $('edit-dialog').showModal();
}
function selectDate(value) {
  $('task-date').value = value;
  $('clear-date').hidden = !value;
  document.querySelectorAll('[data-days]').forEach(b => {
    const selected = value === localDate(Number(b.dataset.days));
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
}
$('today').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
document.querySelectorAll('button[data-space]').forEach(b => b.onclick = () => { space = b.dataset.space; render(); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
document.querySelectorAll('[data-days]').forEach(b => b.onclick = () => selectDate(localDate(Number(b.dataset.days))));
$('task-date').onchange = () => selectDate($('task-date').value);
$('clear-date').onclick = () => selectDate('');
$('account').onclick = openSettings;
$('setup').onclick = openSettings;
$('refresh').onclick = () => refresh();
$('add-form').onsubmit = async event => {
  event.preventDefault();
  const title = $('task-title').value.trim(), due = $('task-date').value;
  if (!title || !validDate(due)) { toast('请填写任务名称和有效日期。', true); return; }
  const task = { id: crypto.randomUUID(), title, space, due, done: false, createdAt: new Date().toISOString() };
  if (await mutate(tasks => [...tasks, task], '已添加待办')) {
    $('task-title').value = ''; selectDate(''); $('task-title').focus();
  }
};
$('edit-form').onsubmit = async event => {
  event.preventDefault();
  const title = $('edit-title').value.trim(), due = $('edit-date').value, category = $('edit-space').value;
  if (!title || !validDate(due)) { toast('请填写任务名称和有效日期。', true); return; }
  if (await mutate(tasks => tasks.map(t => t.id === editing ? { ...t, title, due, space: category } : t), '修改已保存', editingSha)) $('edit-dialog').close();
};
$('delete-task').onclick = async () => {
  if (await mutate(tasks => tasks.filter(t => t.id !== editing), '已删除任务（仓库历史中仍有记录）', editingSha)) $('edit-dialog').close();
};
$('connect-form').onsubmit = async event => {
  event.preventDefault();
  if (busy || demo) return;
  const candidate = { ...defaults, owner: $('owner').value.trim(), repo: $('repo').value.trim() };
  const newToken = $('token').value.trim();
  if (!newToken) return;
  lock(true);
  $('auth-message').textContent = '正在验证连接…';
  try {
    const client = new GithubStore(candidate, newToken);
    const result = await client.read();
    config = candidate; token = newToken; store = client; doc = result.doc; sha = result.sha; loaded = true; lastFetch = Date.now();
    let remembered = true;
    try {
      localStorage.removeItem(storageKey);
      if ($('remember').checked) localStorage.setItem(storageKey, JSON.stringify({ owner: config.owner, repo: config.repo, token }));
    } catch { remembered = false; }
    $('token').value = '';
    $('account-dialog').close();
    status('GitHub · 已同步');
    toast(remembered ? '连接成功，可以开始记录' : '连接成功；浏览器禁止保存设置，关闭后需重新连接');
  } catch (error) { $('auth-message').textContent = error.message; }
  finally { lock(false); render(); }
};
$('disconnect').onclick = async () => {
  if (busy) return;
  try { localStorage.removeItem(storageKey); } catch { /* No persistent storage available. */ }
  token = ''; config = { ...defaults }; store = new GithubStore(config);
  doc = { version: 1, tasks: [] }; sha = ''; loaded = false;
  $('token').value = ''; $('remember').checked = false; $('account-dialog').close();
  render(); await refresh();
};
document.addEventListener('visibilitychange', () => {
  const interval = token ? 30000 : 300000;
  if (document.visibilityState === 'visible' && Date.now() - lastFetch > interval) refresh(true);
});
setInterval(() => { if (!document.hidden && Date.now() - lastFetch > (token ? 30000 : 300000)) refresh(true); }, 30000);

if (demo) {
  doc.tasks = [
    { id: 'demo-1', title: '整理本周项目进展', space: 'work', due: localDate(), done: false, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'demo-2', title: '准备下次会议的讨论要点', space: 'work', due: localDate(1), done: false, createdAt: '2026-01-01T00:01:00Z' },
    { id: 'demo-3', title: '整理常用资料和文件', space: 'work', due: '', done: false, createdAt: '2026-01-01T00:02:00Z' },
    { id: 'demo-4', title: '确认项目时间安排', space: 'work', due: localDate(-1), done: true, createdAt: '2026-01-01T00:03:00Z' },
    { id: 'demo-5', title: '采购周末需要的食材', space: 'life', due: localDate(1), done: false, createdAt: '2026-01-01T00:04:00Z' }
  ];
  loaded = true; status('体验模式 · 不会保存'); render();
} else {
  store = new GithubStore(config, token); render(); refresh();
}

// Optional browser-native agent access. No credentials are returned.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  try {
    Promise.resolve(document.modelContext.registerTool({ name: 'list_todos', title: '查看待办', description: 'Read the currently loaded work or life tasks without modifying them.', inputSchema: { type: 'object', properties: { space: { type: 'string', enum: ['work', 'life'] } }, required: ['space'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input) { if (!input || !['work', 'life'].includes(input.space) || !loaded) throw new Error('Select a valid space after tasks have loaded.'); return { tasks: sortTasks(doc.tasks.filter(t => t.space === input.space)), preview: demo }; } }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* Experimental API; unsupported implementations remain fully usable. */ }
}
