(() => {
  'use strict';
  const status = document.getElementById('status');
  const messages = document.getElementById('messages');
  const input = document.getElementById('message');
  const send = document.getElementById('send');
  const clearHistory = document.getElementById('clear-history');
  const composerError = document.getElementById('composer-error');
  let snapshot = null;
  let version = -1;
  let instanceId = null;
  let sending = false;
  let clearing = false;
  let connected = false;
  let localError = '';
  let connectionError = '';
  const nodes = new Map();

  function updateStatus() {
    const assets = snapshot?.assets;
    const available = assets && (assets.B?.available || assets.E?.available);
    const runtime = snapshot?.runtime;
    const pending = snapshot?.turns?.filter(turn => !['complete','error'].includes(turn.status)) || [];
    send.disabled = sending || clearing || !connected || !available || runtime?.state !== 'ready' || pending.length >= 8;
    clearHistory.disabled = sending || clearing || !connected || !snapshot?.turns?.length || pending.length > 0;
    status.textContent = sending || pending.length ? '对方正在输入中……' : '';
    const error = localError || connectionError || (assets && !available ? '需要先配置手机打字视频，再开始聊天。' : '') ||
      (runtime?.state === 'error' ? runtime.error || 'DeepSeek 暂时不可用，请重新启动。' : '');
    composerError.textContent = error;
    composerError.hidden = !error;
  }

  function disconnected() {
    connected = false;
    connectionError = '连接中断，正在尝试恢复…';
    updateStatus();
  }

  function apply(next) {
    if (!next || typeof next.instanceId !== 'string' || !Array.isArray(next.turns)) return;
    if (instanceId !== next.instanceId) { instanceId = next.instanceId; version = -1; nodes.clear(); messages.replaceChildren(); }
    if (typeof next.version === 'number' && next.version < version) return;
    version = next.version;
    snapshot = next;
    connected = true;
    connectionError = '';
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
    const ordered = [];
    const retained = new Set();
    for (const turn of next.turns) {
      if (!turn || typeof turn.id !== 'string') continue;
      let group = nodes.get(turn.id);
      if (!group) { group = {user:document.createElement('p'), reply:null, error:null}; group.user.className = 'bubble user'; nodes.set(turn.id, group); }
      retained.add(turn.id);
      group.user.textContent = typeof turn.userText === 'string' ? turn.userText : '';
      ordered.push(group.user);
      // The only assistant surface consumes released, completed turn text.
      if (turn.status === 'complete' && typeof turn.reply === 'string') {
        if (!group.reply) { group.reply = document.createElement('p'); group.reply.className = 'bubble assistant'; }
        group.reply.textContent = turn.reply;
        ordered.push(group.reply);
      }
      if (turn.status === 'error') {
        if (!group.error) { group.error = document.createElement('p'); group.error.className = 'turn-error'; }
        group.error.textContent = typeof turn.error === 'string' ? turn.error : '这条消息未完成，请重新发送。';
        ordered.push(group.error);
      }
    }
    for (const key of nodes.keys()) if (!retained.has(key)) nodes.delete(key);
    messages.replaceChildren(...ordered);
    if (nearBottom) messages.scrollTop = messages.scrollHeight;
    updateStatus();
  }

  clearHistory.addEventListener('click', async () => {
    if (clearHistory.disabled) return;
    clearing = true;
    localError = '';
    updateStatus();
    try {
      const response = await fetch('/api/chat/clear', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? '回复进行中，请结束后再清空。' : '清空未成功，请稍后重试。');
      if (!result.snapshot) throw new Error('清空未成功，请稍后重试。');
      apply(result.snapshot);
    } catch (error) {
      localError = error.message === '回复进行中，请结束后再清空。' || error.message === '清空未成功，请稍后重试。' ? error.message : '连接中断，未能清空记录，请稍后重试。';
    } finally { clearing = false; updateStatus(); }
  });

  document.getElementById('composer').addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    sending = true;
    localError = '';
    updateStatus();
    try {
      const response = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})});
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? '暂时无法发送，请确认房间和打字视频已就绪。' : response.status === 429 ? '排队消息较多，请稍候再发。' : '发送未成功，请稍后重试。');
      if (input.value.trim() === text) input.value = '';
      if (result.snapshot) apply(result.snapshot);
      input.focus();
    } catch (error) {
      localError = error.message.startsWith('暂时') || error.message.startsWith('排队') || error.message.startsWith('发送') ? error.message : '连接中断，消息未确认，请恢复连接后重试。';
    } finally { sending = false; updateStatus(); }
  });
  input.addEventListener('input', () => { if (localError) { localError = ''; updateStatus(); } });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.getElementById('composer').requestSubmit(); }
  });
  fetch('/api/state', {cache:'no-store'}).then(response => response.ok ? response.json() : Promise.reject()).then(apply).catch(disconnected);
  const events = new EventSource('/api/events');
  events.addEventListener('state', event => { try { apply(JSON.parse(event.data)); } catch (_) { disconnected(); } });
  events.onerror = disconnected;
})();
