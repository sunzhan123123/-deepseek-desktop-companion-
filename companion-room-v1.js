(() => {
  'use strict';
  const controller = window.roomController;
  const connection = document.getElementById('connection');
  const clientId = crypto.randomUUID();
  let snapshot = null;
  let instanceId = null;
  let version = -1;
  let leaseId = null;
  let online = false;
  let connecting = null;
  let retry = null;
  let job = null;

  function notice(text, state = 'loading') {
    connection.textContent = text;
    connection.dataset.state = state;
    connection.hidden = !text;
  }
  async function post(body) {
    const response = await fetch('/api/room', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if (!response.ok) {
      const error = new Error('房间连接需要恢复');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  function scheduleConnect() {
    online = false;
    notice('连接中，动画会保留当前位置…');
    if (!retry) retry = setTimeout(() => { retry = null; void connect(); }, 1500);
  }
  function assetAnchor() {
    // Admission already records the latest human goal. Move toward that goal
    // while the model works instead of replying forever at the current side.
    const preferred = snapshot.restAnchor === 'F' ? 'E' : 'B';
    if (snapshot.assets?.[preferred]?.available) return preferred;
    const other = preferred === 'B' ? 'E' : 'B';
    return snapshot.assets?.[other]?.available ? other : null;
  }
  function clearJob() {
    if (job) controller.finishTyping({turnId:job.turnId});
    job = null;
  }
  function continueOrReplan(captured, cycleId) {
    captured.ended = null;
    captured.cycleId = null;
    captured.started = false;
    captured.leaseId = null;
    captured.needsFresh = false;
    const anchor = assetAnchor();
    if (anchor && anchor !== captured.anchor) {
      // The old real clip has ended and its ACK (or lease invalidation) has
      // resolved. Replace this turn's destination at that safe boundary.
      clearJob();
      reconcile();
    } else controller.continueTyping({turnId:captured.turnId, cycleId});
  }
  function reconcile() {
    if (!snapshot || !online || !leaseId || !controller.getState().ready || controller.getState().failed) return;
    // A released state can arrive through SSE while its natural-ended ACK is
    // still in flight. Only that captured ACK decides the next cycle.
    if (job?.ackBusy) return;
    const active = snapshot.turns.find(turn => turn.id === snapshot.activeTurnId && !['complete','error'].includes(turn.status));
    if (job && (!active || active.id !== job.turnId)) clearJob();
    if (job && !job.cycleId) {
      const anchor = assetAnchor();
      // No decoded typing cycle is bound yet: retarget the queued route now.
      // The controller still lets its current edge reach its natural end.
      if (anchor && anchor !== job.anchor) clearJob();
    }
    if (!active) {
      controller.setIntent(snapshot.restAnchor === 'F' ? 'sleep' : 'wake');
      notice('', 'ready');
      return;
    }
    if (!job) {
      const anchor = assetAnchor();
      if (!anchor) { notice('需要先配置手机打字视频。', 'setup'); return; }
      job = {turnId:active.id, anchor, cycleId:null, leaseId:null, startPromise:null, started:false, ended:null, ackBusy:false, needsFresh:false};
      if (!controller.queueTyping({turnId:active.id, anchor})) { job = null; return; }
    }
    notice('', 'ready');
    if (job.ended && !job.ackBusy) void acknowledge(job);
  }
  function apply(next) {
    if (!next || typeof next.instanceId !== 'string' || !Array.isArray(next.turns)) return;
    if (instanceId !== null && instanceId !== next.instanceId) {
      clearJob();
      leaseId = null;
      online = false;
      version = -1;
    }
    instanceId = next.instanceId;
    if (typeof next.version === 'number' && next.version < version) return;
    version = next.version;
    snapshot = next;
    if (!leaseId) { if (!connecting) void connect(); return; }
    reconcile();
  }
  async function connect() {
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const result = await post({action:'connect', clientId});
        const previousLease = leaseId;
        leaseId = result.leaseId;
        online = true;
        if (job && previousLease !== leaseId && job.cycleId) job.needsFresh = true;
        apply(result.snapshot);
        // An instance changed while this connect response was being applied.
        if (!leaseId) { scheduleConnect(); return; }
        if (job?.cycleId && !job.needsFresh && !job.started && !job.startPromise) void bindCycle(job);
        reconcile();
      } catch (error) {
        notice(error.status === 409 ? '另一个房间窗口正在播放，等待连接…' : '连接中，动画会保留当前位置…');
        scheduleConnect();
      } finally { connecting = null; }
    })();
    return connecting;
  }
  async function bindCycle(captured) {
    if (job !== captured || !online || !leaseId || captured.needsFresh || !captured.cycleId) return;
    const cycleId = captured.cycleId;
    const capturedLease = leaseId;
    captured.leaseId = capturedLease;
    captured.startPromise = (async () => {
      try {
        const result = await post({action:'typing-started', clientId, leaseId:capturedLease, turnId:captured.turnId, anchor:captured.anchor, cycleId});
        if (job !== captured || captured.cycleId !== cycleId || leaseId !== capturedLease) return;
        captured.started = true;
        apply(result.snapshot);
      } catch (_) {
        if (job === captured && captured.cycleId === cycleId) { captured.started = false; scheduleConnect(); }
      } finally {
        if (job === captured && captured.cycleId === cycleId) captured.startPromise = null;
      }
    })();
    await captured.startPromise;
    if (job === captured && captured.ended) void acknowledge(captured);
  }
  async function acknowledge(captured) {
    if (job !== captured || captured.ackBusy || !captured.ended || !online || !leaseId) return;
    if (captured.startPromise) await captured.startPromise;
    // Several observers can wait on one delayed started response. Recheck the
    // owner and in-flight barrier after that asynchronous boundary.
    if (job !== captured || captured.ackBusy || !captured.ended || !online || !leaseId) return;
    const cycleId = captured.cycleId;
    if (captured.needsFresh || (captured.leaseId && captured.leaseId !== leaseId)) {
      // An expired lease cannot claim time already played. Finish that owner,
      // then establish a completely new full cycle under the new lease.
      continueOrReplan(captured, cycleId);
      return;
    }
    if (!captured.started) { if (!captured.startPromise) void bindCycle(captured); return; }
    const capturedLease = leaseId;
    captured.ackBusy = true;
    try {
      const result = await post({action:'typing-ended', clientId, leaseId:capturedLease, turnId:captured.turnId, anchor:captured.anchor, cycleId});
      if (job !== captured || captured.cycleId !== cycleId || leaseId !== capturedLease) return;
      if (result.turnId !== captured.turnId || result.cycleId !== cycleId) { scheduleConnect(); return; }
      apply(result.snapshot);
      captured.ackBusy = false;
      const stillActive = snapshot?.activeTurnId === captured.turnId && !['complete','error'].includes(snapshot.turns.find(turn => turn.id === captured.turnId)?.status);
      if (result.decision === 'continue' && stillActive) {
        continueOrReplan(captured, cycleId);
      } else if (result.decision === 'finished' || !stillActive) {
        clearJob();
        reconcile();
      } else scheduleConnect();
    } catch (_) {
      if (job === captured) scheduleConnect();
    } finally { if (job === captured) captured.ackBusy = false; }
  }
  window.addEventListener('room:typing-started', event => {
    const detail = event.detail;
    if (!job || detail.turnId !== job.turnId || detail.anchor !== job.anchor) return;
    job.cycleId = detail.cycleId;
    job.leaseId = leaseId;
    job.started = false;
    job.ended = null;
    job.needsFresh = false;
    void bindCycle(job);
  });
  window.addEventListener('room:typing-ended', event => {
    const detail = event.detail;
    if (!job || detail.turnId !== job.turnId || detail.anchor !== job.anchor || detail.cycleId !== job.cycleId) return;
    job.ended = {...detail};
    void acknowledge(job);
  });
  window.addEventListener('room:ready', reconcile);
  setInterval(async () => {
    if (!leaseId || !online) { void connect(); return; }
    const capturedLease = leaseId;
    try {
      const result = await post({action:'heartbeat', clientId, leaseId:capturedLease});
      if (leaseId === capturedLease) apply(result.snapshot);
    } catch (_) { scheduleConnect(); }
  }, 5000);
  const events = new EventSource('/api/events');
  events.addEventListener('state', event => { try { apply(JSON.parse(event.data)); } catch (_) { scheduleConnect(); } });
  events.onerror = scheduleConnect;
  void connect();
})();
