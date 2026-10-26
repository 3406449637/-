// ==UserScript==
// @name         雨课堂视频串行队列（2 倍速）
// @namespace    https://changjiang.yuketang.cn/
// @version      1.3.1
// @description  读取雨课堂课程中未完成的视频，按顺序在独立标签页中逐个播放；自动切换平台支持的 2 倍速、定时检查完成情况并进入下一条。
// @author       ZCode
// @match        https://changjiang.yuketang.cn/pro/lms/*/studycontent*
// @match        https://changjiang.yuketang.cn/v2/web/studentLog*
// @match        https://changjiang.yuketang.cn/ai-workspace/lms-graph/*/video/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '1.0.0';
  const STORAGE_PREFIX = 'ykt-video-queue-v1';
  const WORKER_NAME = 'ykt-video-queue-worker';
  const WORKER_HASH = 'ykt-video-queue';
  const WORKER_SESSION_KEY = 'ykt-video-queue-worker-mode';
  const CHANNEL_NAME = 'ykt-video-queue-channel';
  const SPEED = 2;
  const SUPPORTED_SPEEDS = [2];
  const COMPLETE_THRESHOLD = 0.999;
  const HEARTBEAT_MS = 5000;
  const STALE_MS = 45000;
  const MAX_CHECK_MS = 10 * 60 * 1000;
  const MIN_CHECK_MS = 2000;
  const PER_VIDEO_OVERHEAD_SECONDS = 6;

  try {
    console.info(`[雨课堂视频队列] v${VERSION} 已加载：${location.href}`);
  } catch (_) {}

  const page = detectPage();
  if (!page) return;

  if (page.kind === 'course') {
    initCoursePage(page);
  } else if (page.kind === 'video' && isWorkerTab()) {
    initWorkerPage(page);
  }

  // ---------------------------------------------------------------------------
  // Common helpers
  // ---------------------------------------------------------------------------

  function detectPage() {
    const courseMatch = location.pathname.match(/^\/pro\/lms\/([^/]+)\/(\d+)\/studycontent(?:\/|$)/);
    if (courseMatch) {
      let sign = courseMatch[1];
      try { sign = decodeURIComponent(sign); } catch (_) {}
      return { kind: 'course', courseSign: sign, classroomId: String(courseMatch[2]) };
    }

    const logMatch = location.pathname.match(/^\/v2\/web\/studentLog(?:\/(\d+))?(?:\/|$)/);
    if (logMatch) {
      const classroomId = logMatch[1] || new URLSearchParams(location.search).get('classroom_id');
      if (classroomId) {
        return { kind: 'course', courseSign: '', classroomId: String(classroomId) };
      }
    }

    const videoMatch = location.pathname.match(/^\/ai-workspace\/lms-graph\/(\d+)\/video\/(\d+)(?:\/|$)/);
    if (videoMatch) {
      return { kind: 'video', classroomId: String(videoMatch[1]), leafId: Number(videoMatch[2]) };
    }

    return null;
  }

  function isWorkerTab() {
    if (window.name === WORKER_NAME) return true;
    try {
      if (location.hash.replace(/^#/, '') === WORKER_HASH) return true;
      if (sessionStorage.getItem(WORKER_SESSION_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function storageKey(classroomId) {
    return `${STORAGE_PREFIX}:${classroomId}`;
  }

  function loadState(classroomId) {
    try {
      const raw = localStorage.getItem(storageKey(classroomId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    if (!state) return;
    state.updatedAt = Date.now();
    state.completedVideos = countCompleted(state);
    try {
      localStorage.setItem(storageKey(state.classroomId), JSON.stringify(state));
    } catch (_) {}
  }

  function countCompleted(state) {
    if (!state) return 0;
    const queueDone = state.queue.filter(isItemDone).length;
    return Math.min(state.totalVideos || 0, (state.baseCompleted || 0) + queueDone);
  }

  function isItemDone(item) {
    return !!item && (item.playedToEnd === true || Number(item.progress) >= COMPLETE_THRESHOLD);
  }

  function normalizeProgress(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function pct(value) {
    return `${Math.round(normalizeProgress(value) * 100)}%`;
  }

  function formatTime(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function videoPageUrl(classroomId, leafId, chapterId) {
    const url = new URL(`/ai-workspace/lms-graph/${classroomId}/video/${leafId}`, location.origin);
    url.searchParams.set('is_chapter', '1');
    if (chapterId != null) url.searchParams.set('node_id', String(chapterId));
    return url.href;
  }

  function withWorkerHash(url) {
    const parsed = new URL(url, location.origin);
    parsed.hash = WORKER_HASH;
    return parsed.href;
  }

  function truncate(value, max) {
    const text = cleanText(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  async function apiGet(path, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          XTBZ: 'ykt',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (body && body.success === false) throw new Error(body.msg || '接口返回失败');
      return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('接口请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchProgressData(classroomId) {
    return apiGet(`/c27/online_courseware/schedule/course/progress/?classroom_id=${encodeURIComponent(classroomId)}`);
  }

  function extractVideos(progressData, classroomId) {
    const chapters = progressData && progressData.course_progress;
    if (!Array.isArray(chapters)) throw new Error('课程进度数据结构异常');

    const videos = [];
    const seen = new Set();

    for (const chapter of chapters) {
      const chapterId = chapter.id;
      const chapterName = cleanText(chapter.name);
      const sectionEntries = Array.isArray(chapter.section_leaf_list) ? chapter.section_leaf_list : [];

      for (const section of sectionEntries) {
        const sectionName = cleanText(section.name);
        const leaves = Array.isArray(section.leaf_list) ? section.leaf_list : [];
        const directLeaf = !leaves.length && Number(section.leaf_type) === 0 ? [section] : [];

        for (const leaf of [...leaves, ...directLeaf]) {
          if (!leaf || Number(leaf.leaf_type) !== 0) continue;
          if (seen.has(leaf.id)) continue;
          seen.add(leaf.id);

          const rawName = cleanText(leaf.name);
          const title = !rawName || /^video$/i.test(rawName)
            ? (sectionName || `视频 ${leaf.id}`)
            : rawName;
          const chapterLabel = chapterName && chapterName !== title ? `${chapterName} / ${title}` : title;

          videos.push({
            leafId: Number(leaf.id),
            chapterId: Number(chapterId),
            sectionId: Number(section.id || 0),
            chapterName,
            sectionName,
            title,
            label: chapterLabel,
            progress: normalizeProgress(leaf.progress),
            playedToEnd: false,
            completedAt: 0,
            url: videoPageUrl(classroomId, leaf.id, chapterId),
          });
        }
      }
    }

    return videos;
  }

  async function getLeafProgress(classroomId, leafId) {
    try {
      const data = await fetchProgressData(classroomId);
      const videos = extractVideos(data, classroomId);
      const item = videos.find((video) => video.leafId === Number(leafId));
      return item ? item.progress : null;
    } catch (_) {
      return null;
    }
  }

  function durationCacheKey(classroomId) {
    return `ykt-video-durations-v1:${classroomId}`;
  }

  function loadDurationCache(classroomId) {
    try {
      const raw = localStorage.getItem(durationCacheKey(classroomId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.durations) return {};
      const clean = {};
      for (const [leafId, duration] of Object.entries(parsed.durations)) {
        const value = Number(duration);
        if (Number.isFinite(value) && value > 0) clean[leafId] = value;
      }
      return clean;
    } catch (_) {
      return {};
    }
  }

  function saveDurationCache(classroomId, durations) {
    try {
      localStorage.setItem(durationCacheKey(classroomId), JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        durations,
      }));
    } catch (_) {}
  }

  function normalizeTargetSpeed(value) {
    const numeric = Number(value);
    return SUPPORTED_SPEEDS.includes(numeric) ? numeric : SPEED;
  }

  async function fetchVideoDuration(classroomId, leafId) {
    try {
      const data = await apiGet(
        `/mooc-api/v1/lms/learn/leaf_info/${classroomId}/${leafId}/?classroom_id=${classroomId}`,
        8000,
      );
      const media = data && data.content_info && data.content_info.media;
      const duration = Number(media && media.duration);
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (_) {
      return null;
    }
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = await fn(items[index], index);
        } catch (_) {
          results[index] = null;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  function formatEstimate(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) return `${Math.max(1, total)} 秒`;
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  function estimateQueueSeconds(state, durations, targetSpeed = SPEED) {
    if (!state || !Array.isArray(state.queue) || !state.queue.length) {
      return { seconds: 0, known: 0, estimated: 0, unknown: 0, pending: 0 };
    }

    const pending = state.queue.filter((item) => !isItemDone(item));
    if (!pending.length) return { seconds: 0, known: 0, estimated: 0, unknown: 0, pending: 0 };

    const baseSpeed = normalizeTargetSpeed(targetSpeed);
    const current = currentItem(state);
    const liveDuration = Number(state.duration) || 0;
    const rows = pending.map((item) => {
      const isCurrent = !!(current && current.leafId === item.leafId);
      const exactDuration = isCurrent && liveDuration > 0
        ? liveDuration
        : Number(durations && durations[item.leafId]) || 0;
      return { item, isCurrent, exactDuration };
    });

    const exactValues = rows.map((row) => row.exactDuration).filter((value) => value > 0);
    const averageDuration = exactValues.length
      ? exactValues.reduce((sum, value) => sum + value, 0) / exactValues.length
      : 0;

    let seconds = pending.length * PER_VIDEO_OVERHEAD_SECONDS;
    let known = 0;
    let estimated = 0;
    let unknown = 0;

    for (const row of rows) {
      let duration = row.exactDuration;
      if (duration > 0) {
        known += 1;
      } else if (averageDuration > 0) {
        duration = averageDuration;
        estimated += 1;
      } else {
        unknown += 1;
        continue;
      }

      if (row.isCurrent && liveDuration > 0) {
        const actualRate = Number(state.speed) > 0 ? Number(state.speed) : baseSpeed;
        seconds += Math.max(0, liveDuration - (Number(state.currentTime) || 0)) / actualRate;
      } else {
        seconds += (duration * (1 - normalizeProgress(row.item.progress))) / baseSpeed;
      }
    }

    return { seconds, known, estimated, unknown, pending: pending.length };
  }

  // ---------------------------------------------------------------------------
  // Course page
  // ---------------------------------------------------------------------------

  function initCoursePage(coursePage) {
    let state = loadState(coursePage.classroomId);
    let loading = false;
    let messageTimer = null;
    let lastListSignature = '';
    let workerWindow = null;
    let durationCache = loadDurationCache(coursePage.classroomId);
    let durationLoading = false;
    let durationFetchPromise = null;
    let targetSpeed = SPEED;
    const durationAttempted = new Set();

    const ui = createCoursePanel();
    const channel = createChannel();

    bindCourseEvents();
    renderCourse();

    if (!state) {
      refreshQueue({ automatic: true });
    } else if (state.running && Date.now() - Number(state.heartbeatAt || 0) > STALE_MS) {
      state.status = 'interrupted';
      saveState(state);
      renderCourse();
    }

    if (state && state.queue.length) {
      ensureDurations(state.queue);
    }

    setInterval(() => {
      if (loading) return;
      const fresh = loadState(coursePage.classroomId);
      const changed = (fresh && fresh.updatedAt) !== (state && state.updatedAt);
      if (changed) state = fresh;
      renderCourse();
    }, 2000);

    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey(coursePage.classroomId)) return;
      const fresh = loadState(coursePage.classroomId);
      if (fresh) {
        state = fresh;
        renderCourse();
      }
    });

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== coursePage.classroomId) return;
        if (event.data.type === 'state-changed' || event.data.type === 'worker-ready') {
          const fresh = loadState(coursePage.classroomId);
          if (fresh) state = fresh;
          renderCourse();
        }
      };
    }

    function bindCourseEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-course-panel-collapsed');
          return;
        }
        if (action === 'refresh') {
          if (loading) return;
          if (state && state.running) {
            showMessage('请先停止当前队列，再刷新课程进度。', 'warn');
            return;
          }
          durationAttempted.clear();
          await refreshQueue({ manual: true });
          return;
        }
        if (action === 'primary') {
          await handlePrimary();
          return;
        }
        if (action === 'stop') {
          handleStop();
        }
      });
    }

    function ensureDurations(items) {
      if (!items || !items.length) return Promise.resolve();
      if (durationFetchPromise) return durationFetchPromise;

      const missing = items.filter((item) => (
        !isItemDone(item)
        && !Number(durationCache[item.leafId])
        && !durationAttempted.has(item.leafId)
      ));
      if (!missing.length) return Promise.resolve();

      for (const item of missing) durationAttempted.add(item.leafId);
      durationLoading = true;
      renderCourse();

      durationFetchPromise = (async () => {
        await mapLimit(missing, 4, async (item) => {
          const duration = await fetchVideoDuration(coursePage.classroomId, item.leafId);
          if (duration) {
            durationCache[item.leafId] = duration;
            saveDurationCache(coursePage.classroomId, durationCache);
            renderCourse();
          }
        });
        saveDurationCache(coursePage.classroomId, durationCache);
      })().finally(() => {
        durationLoading = false;
        durationFetchPromise = null;
        renderCourse();

        const stillMissing = (state && state.queue || []).some((item) => (
          !isItemDone(item)
          && !Number(durationCache[item.leafId])
          && !durationAttempted.has(item.leafId)
        ));
        if (stillMissing) ensureDurations(state.queue);
      });

      return durationFetchPromise;
    }

    async function refreshQueue(options = {}) {
      if (loading) return;
      loading = true;
      renderCourse();
      try {
        const data = await fetchProgressData(coursePage.classroomId);
        const videos = extractVideos(data, coursePage.classroomId);
        const pending = videos.filter((item) => !isItemDone(item));
        const snapshot = {
          videos,
          pending,
          total: videos.length,
          completed: videos.length - pending.length,
        };

        state = makeFreshState(coursePage, snapshot);
        state.targetSpeed = targetSpeed;
        state.speed = targetSpeed;
        saveState(state);
        ensureDurations(state.queue);
        if (options.manual) showMessage(`已读取课程进度：${pending.length} 个视频待看。`, 'ok');
      } catch (error) {
        if (!state) {
          showMessage(`读取失败：${truncate(error.message, 140)}`, 'error');
        } else if (options.manual) {
          showMessage(`刷新失败：${truncate(error.message, 140)}`, 'error');
        }
      } finally {
        loading = false;
        renderCourse();
      }
    }

    async function handlePrimary() {
      if (loading) return;

      const hasCurrent = !!(state && currentItem(state));

      if (state && hasCurrent && state.status === 'attention') {
        focusWorker();
        return;
      }

      if (state && hasCurrent && (state.status === 'error' || state.status === 'paused' || state.userPaused)) {
        resumeQueue();
        return;
      }

      if (state && state.running) {
        if (isAlive(state)) {
          showMessage('队列正在运行，视频会在旁边的标签页中继续播放。', 'ok');
          return;
        }
        resumeQueue();
        return;
      }

      if (state && ['paused', 'error', 'interrupted'].includes(state.status)) {
        if (hasCurrent) {
          resumeQueue();
        } else {
          await startFresh();
        }
        return;
      }

      if (state && state.status === 'stopped' && hasCurrent) {
        resumeQueue();
        return;
      }

      if (state && state.status === 'idle' && state.queue.length && Date.now() - Number(state.createdAt || 0) < 5 * 60 * 1000) {
        startFromPreparedState();
        return;
      }

      await startFresh();
    }

    function startFromPreparedState() {
      if (!state || !state.queue.length) {
        startFresh();
        return;
      }
      state.index = findFirstPendingIndex(state);
      if (state.index < 0) {
        showMessage('待看队列为空，请点击“刷新”重新扫描。', 'warn');
        return;
      }
      state.running = true;
      state.status = 'watching';
      state.userPaused = false;
      state.targetSpeed = targetSpeed;
      state.speed = targetSpeed;
      state.startedAt = state.startedAt || Date.now();
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      saveState(state);
      ensureDurations(state.queue);
      renderCourse();

      const item = state.queue[state.index];
      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) {
        showPopupBlocked(item);
      }
    }

    async function startFresh() {
      if (loading) return;
      const blank = openWorker('about:blank');
      if (!blank) {
        showMessage('浏览器拦截了新标签页。请允许本站弹窗后，再点一次“开始”。', 'error');
        return;
      }

      loading = true;
      renderCourse();
      try {
        const data = await fetchProgressData(coursePage.classroomId);
        const videos = extractVideos(data, coursePage.classroomId);
        const pending = videos.filter((item) => !isItemDone(item));
        const snapshot = {
          videos,
          pending,
          total: videos.length,
          completed: videos.length - pending.length,
        };

        state = makeFreshState(coursePage, snapshot);
        state.targetSpeed = targetSpeed;
        state.speed = targetSpeed;
        if (!pending.length) {
          state.status = 'done';
          state.completedVideos = state.totalVideos;
          saveState(state);
          try { blank.close(); } catch (_) {}
          showMessage('课程中的视频都已标记为完成，没有待看队列。', 'ok');
          return;
        }

        state.running = true;
        state.status = 'watching';
        state.startedAt = Date.now();
        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = 0;
        saveState(state);
        ensureDurations(state.queue);
        renderCourse();

        const first = pending[0];
        try {
          blank.location.replace(withWorkerHash(first.url));
          blank.focus();
        } catch (_) {
          try { blank.close(); } catch (_) {}
          showMessage('打开视频标签页失败，请重试。', 'error');
          state.running = false;
          state.status = 'error';
          state.lastError = '打开视频标签页失败';
          saveState(state);
          renderCourse();
        }
      } catch (error) {
        try { blank.close(); } catch (_) {}
        state = state || null;
        showMessage(`读取课程进度失败：${truncate(error.message, 140)}`, 'error');
      } finally {
        loading = false;
        renderCourse();
      }
    }

    function resumeQueue() {
      if (!state) return;
      const item = currentItem(state);
      if (!item) {
        startFresh();
        return;
      }
      state.running = true;
      state.status = 'watching';
      state.userPaused = false;
      state.targetSpeed = targetSpeed;
      state.speed = targetSpeed;
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      saveState(state);
      renderCourse();

      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) showPopupBlocked(item);
    }

    function openWorker(url) {
      try {
        return window.open(url, WORKER_NAME);
      } catch (_) {
        return null;
      }
    }

    function focusWorker() {
      if (workerWindow && !workerWindow.closed) {
        try {
          workerWindow.focus();
          return;
        } catch (_) {}
      }
      const item = currentItem(state);
      if (!item) return;
      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) showPopupBlocked(item);
    }

    function showPopupBlocked(item) {
      showMessage(
        '浏览器拦截了新标签页。请允许本站弹窗后重试，或点击这里手动打开视频标签页。',
        'warn',
        withWorkerHash(item.url),
      );
    }

    function handleStop() {
      if (!state) return;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      if (channel) {
        channel.postMessage({ type: 'stop', classroomId: coursePage.classroomId });
      }
      showMessage('队列已停止。再次点击“继续观看”会从当前视频恢复。', 'warn');
      renderCourse();
    }

    function renderCourse() {
      if (state && state.running) {
        targetSpeed = normalizeTargetSpeed(state.targetSpeed || targetSpeed);
      }

      const pending = state ? Math.max(0, (state.totalVideos || 0) - countCompleted(state)) : null;
      ui.refs.pending.textContent = pending == null ? '—' : String(pending);
      ui.refs.total.textContent = state ? String(state.totalVideos || 0) : '—';
      ui.refs.done.textContent = state ? String(countCompleted(state)) : '—';
      ui.refs.estimateHint.textContent = `${targetSpeed.toFixed(1)}× · 含切换`;

      const estimate = estimateQueueSeconds(state, durationCache, targetSpeed);
      if (!state) {
        ui.refs.estimate.textContent = '—';
      } else if (!estimate.pending) {
        ui.refs.estimate.textContent = '0 分钟';
      } else if (estimate.known === 0 && estimate.estimated === 0) {
        ui.refs.estimate.textContent = durationLoading ? '计算中…' : '暂时无法估算';
      } else {
        let estimateText = `约 ${formatEstimate(estimate.seconds)}`;
        if (durationLoading) {
          estimateText += '（更新中）';
        } else if (estimate.estimated > 0) {
          estimateText += `（含 ${estimate.estimated} 条估算）`;
        } else if (estimate.unknown > 0) {
          estimateText += `（${estimate.unknown} 条无法估算）`;
        }
        ui.refs.estimate.textContent = estimateText;
      }

      const item = state ? currentItem(state) : null;
      const alive = state ? isAlive(state) : false;
      const status = getCourseStatus(state, alive);

      ui.refs.status.textContent = status.text;
      ui.refs.dot.className = `dot ${status.tone}`;

      if (state && state.workerHeartbeatAt && ui.refs.message.querySelector('.manualLink')) {
        ui.refs.message.hidden = true;
        ui.refs.message.textContent = '';
      }

      if (item && state && (state.running || ['paused', 'error', 'interrupted', 'transitioning'].includes(state.status))) {
        ui.refs.current.hidden = false;
        ui.refs.curTitle.textContent = item.label;
        const progress = Math.max(normalizeProgress(item.progress), normalizeProgress(state.serverProgress));
        ui.refs.curFill.style.width = `${Math.round(progress * 100)}%`;
        const pieces = [
          `平台 ${pct(item.progress)}`,
          `队列 ${state.index + 1}/${state.queue.length}`,
        ];
        if (state.duration > 0) {
          pieces.push(`本地 ${formatTime(state.currentTime)} / ${formatTime(state.duration)}`);
        }
        if (state.speed) pieces.push(`${Number(state.speed).toFixed(2)}×`);
        ui.refs.curMeta.textContent = pieces.join(' · ');
      } else {
        ui.refs.current.hidden = true;
      }

      const primary = ui.refs.primary;
      const refresh = ui.refs.refresh;
      const stop = ui.refs.stop;

      if (loading) {
        primary.textContent = '读取中…';
        primary.disabled = true;
      } else if (!state) {
        primary.textContent = '读取队列';
        primary.disabled = false;
      } else if (state.status === 'error' && item) {
        primary.textContent = '重新打开视频页';
        primary.disabled = false;
      } else if (state.status === 'attention' && item) {
        primary.textContent = '切换到视频页';
        primary.disabled = false;
      } else if ((state.userPaused || state.status === 'paused') && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.running && alive) {
        primary.textContent = '队列运行中';
        primary.disabled = true;
      } else if (state.running && !alive) {
        primary.textContent = '重新打开视频页';
        primary.disabled = false;
      } else if (['interrupted'].includes(state.status) && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.status === 'stopped' && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.status === 'done') {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      } else {
        primary.textContent = state.queue.length ? '开始队列' : '重新扫描';
        primary.disabled = false;
      }

      refresh.disabled = loading || !!(state && state.running && alive);
      stop.hidden = !(state && (state.running || ['paused', 'error', 'interrupted'].includes(state.status)));

      ui.refs.queueCount.textContent = state ? `(${state.queue.length})` : '';
      ui.refs.queueBox.hidden = !state || !state.queue.length;

      const listSignature = state
        ? `${state.index}|${state.currentLeafId}|${state.queue.map((q) => `${q.leafId}:${q.progress}:${q.playedToEnd ? 1 : 0}`).join(',')}`
        : 'empty';
      if (listSignature !== lastListSignature) {
        lastListSignature = listSignature;
        renderQueueList();
      }
    }

    function renderQueueList() {
      const list = ui.refs.queueList;
      list.textContent = '';
      if (!state) return;

      state.queue.forEach((item, index) => {
        const row = document.createElement('li');
        if (index === state.index || item.leafId === state.currentLeafId) row.classList.add('current');
        if (isItemDone(item)) row.classList.add('done');

        const indexEl = document.createElement('span');
        indexEl.className = 'idx';
        indexEl.textContent = String(index + 1);

        const textEl = document.createElement('span');
        textEl.className = 'itemText';
        const titleEl = document.createElement('span');
        titleEl.className = 'itemTitle';
        titleEl.textContent = item.title || item.label;
        const chapterEl = document.createElement('span');
        chapterEl.className = 'itemChapter';
        chapterEl.textContent = item.chapterName || '';
        textEl.append(titleEl, chapterEl);

        const progressEl = document.createElement('span');
        progressEl.className = 'itemProgress';
        progressEl.textContent = item.playedToEnd ? '已播完' : pct(item.progress);

        row.append(indexEl, textEl, progressEl);
        list.appendChild(row);
      });
    }

    function getCourseStatus(currentState, alive) {
      if (loading) return { text: '正在读取课程进度…', tone: 'busy' };
      if (!currentState) return { text: '尚未读取课程进度', tone: 'idle' };

      if (currentState.status === 'error') {
        return { text: `需要处理：${truncate(currentState.lastError || '未知错误', 80)}`, tone: 'error' };
      }
      if (currentState.status === 'attention') {
        return { text: '视频已暂停；请切回视频页继续', tone: 'warn' };
      }
      if (currentState.userPaused || currentState.status === 'paused') {
        return { text: '已暂停', tone: 'warn' };
      }
      if (currentState.running && alive) {
        if (currentState.status === 'transitioning') return { text: '正在切换到下一条视频…', tone: 'busy' };
        if (!currentState.workerHeartbeatAt) return { text: '正在连接视频标签页…', tone: 'busy' };
        return { text: '观看中 · 视频标签页正在运行', tone: 'active' };
      }
      if (currentState.running && !alive) {
        return { text: '视频标签页未连接（可能已关闭）', tone: 'warn' };
      }
      if (currentState.status === 'stopped') return { text: '队列已停止', tone: 'idle' };
      if (currentState.status === 'done') return { text: '队列完成', tone: 'active' };
      if (currentState.status === 'interrupted') return { text: '上次的视频标签页已断开', tone: 'warn' };
      return { text: '等待开始', tone: 'idle' };
    }

    function showMessage(text, tone = 'ok', manualUrl = '') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = '';
      box.className = `message ${tone}`;
      box.hidden = false;

      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);

      if (manualUrl) {
        const link = document.createElement('a');
        link.href = manualUrl;
        link.target = WORKER_NAME;
        link.textContent = '手动打开';
        link.className = 'manualLink';
        box.appendChild(link);
        return;
      }

      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 12000 : 8000);
    }
  }

  function makeFreshState(coursePage, snapshot) {
    const now = Date.now();
    return {
      version: 1,
      classroomId: String(coursePage.classroomId),
      courseSign: coursePage.courseSign || '',
      createdAt: now,
      updatedAt: now,
      queue: snapshot.pending,
      totalVideos: snapshot.total,
      baseCompleted: snapshot.completed,
      completedVideos: snapshot.completed,
      index: 0,
      running: false,
      status: 'idle',
      currentLeafId: null,
      currentTitle: '',
      currentTime: 0,
      duration: 0,
      speed: SPEED,
      targetSpeed: SPEED,
      serverProgress: 0,
      userPaused: false,
      startedAt: 0,
      heartbeatAt: 0,
      workerHeartbeatAt: 0,
      lastError: '',
    };
  }

  function findFirstPendingIndex(state) {
    return state.queue.findIndex((item) => !isItemDone(item));
  }

  function currentItem(state) {
    if (!state || !state.queue.length) return null;
    if (state.currentLeafId != null) {
      const byId = state.queue.find((item) => item.leafId === Number(state.currentLeafId));
      if (byId) return byId;
    }
    return state.queue[state.index] || null;
  }

  function isAlive(state) {
    return !!state && state.running && Date.now() - Number(state.heartbeatAt || 0) < STALE_MS;
  }

  // ---------------------------------------------------------------------------
  // Video worker page
  // ---------------------------------------------------------------------------

  function initWorkerPage(videoPage) {
    try { sessionStorage.setItem(WORKER_SESSION_KEY, '1'); } catch (_) {}

    let state = loadState(videoPage.classroomId);
    if (!state || !state.running || !state.queue.length) return;

    if (state.index >= state.queue.length) {
      state.running = false;
      state.status = 'done';
      saveState(state);
      return;
    }

    let item = state.queue[state.index];
    const redirectTarget = withWorkerHash(item.url);

    if (Number(item.leafId) !== Number(videoPage.leafId)) {
      try {
        const redirectKey = `ykt-last-redirect:${videoPage.leafId}`;
        const previous = Number(sessionStorage.getItem(redirectKey) || 0);
        if (Date.now() - previous > 5000) {
          sessionStorage.setItem(redirectKey, String(Date.now()));
          location.replace(redirectTarget);
        }
      } catch (_) {
        location.replace(redirectTarget);
      }
      return;
    }

    const targetSpeed = normalizeTargetSpeed(state.targetSpeed);
    state.targetSpeed = targetSpeed;

    let video = null;
    let checkTimer = null;
    let heartbeatTimer = null;
    let uiTimer = null;
    let speedTimer = null;
    let finishing = false;
    let stopped = false;
    let internalPause = false;
    let attentionPaused = false;
    let attentionReason = '';
    let pauseProbeTimer = null;
    let pauseGraceUntil = 0;
    let lastAttentionResumeAttempt = 0;
    let lastStateWrite = 0;
    let messageTimer = null;
    let speedFailures = 0;

    const ui = createWorkerPanel();
    const channel = createChannel();

    state.status = 'watching';
    state.currentLeafId = item.leafId;
    state.currentTitle = item.label;
    state.heartbeatAt = Date.now();
    state.workerHeartbeatAt = Date.now();
    state.lastError = '';
    saveState(state);
    updateWorkerUi();

    bindWorkerEvents();
    startHeartbeat();
    startUiTicker();

    boot().catch(handleFatalError);

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== videoPage.classroomId) return;
        if (event.data.type === 'stop') stopByExternalRequest();
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey(videoPage.classroomId)) return;
      const fresh = loadState(videoPage.classroomId);
      if (fresh && !fresh.running && state.running && !stopped) {
        stopByExternalRequest();
      }
    });

    window.addEventListener('beforeunload', () => {
      clearTimeout(checkTimer);
      clearInterval(heartbeatTimer);
      clearInterval(uiTimer);
      clearInterval(speedTimer);
    });

    async function boot() {
      video = await waitForVideo(30000);
      if (!video) {
        throw new Error('超过 30 秒仍未找到播放器，请刷新页面重试');
      }

      await waitForMetadata(video, 12000);

      video.addEventListener('ended', () => {
        if (stopped || !state.running || state.userPaused || finishing) return;
        finishing = true;
        confirmCompletion().catch(handleFatalError);
      });

      video.addEventListener('play', () => {
        internalPause = false;
        if (attentionPaused && !isPageActive()) {
          enforceAttentionPause();
          return;
        }
        if (state.running && !state.userPaused && isPageActive()) {
          const wasAttention = attentionPaused;
          attentionPaused = false;
          attentionReason = '';
          state.status = 'watching';
          saveWorkerState();
          scheduleCheck();
          updateWorkerUi();
          if (wasAttention) {
            ensureTargetSpeed()
              .then((ok) => { if (ok) startSpeedGuard(); })
              .catch(() => {});
          }
        }
      });

      video.addEventListener('pause', onVideoPause);
      video.addEventListener('waiting', () => {
        updateWorkerUi();
      });
      video.addEventListener('playing', () => {
        updateWorkerUi();
      });

      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('blur', onWindowBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);

      pauseGraceUntil = Date.now() + 2500;

      if (!isPageActive()) {
        enterAttention('focus');
        return;
      }

      await ensurePlaying();
      const speedOk = await ensureTargetSpeed();
      if (!speedOk) {
        setWorkerMessage(`未能自动切换到 ${targetSpeed.toFixed(2)} 倍速，将按播放器当前速度计时。`, 'warn');
      }

      state.currentTime = video.currentTime || 0;
      state.duration = Number.isFinite(video.duration) ? video.duration : 0;
      state.speed = video.playbackRate || 1;
      saveWorkerState();
      updateWorkerUi();
      scheduleCheck();
      startSpeedGuard();
    }

    function isPageActive() {
      return !document.hidden && document.hasFocus();
    }

    function enforceAttentionPause() {
      if (!attentionPaused || state.userPaused || stopped || !video || video.paused) return;
      internalPause = true;
      try { video.pause(); } catch (_) {}
    }

    function onVideoPause() {
      if (internalPause || stopped || !state.running || state.userPaused || finishing) return;
      if (!video || video.ended) return;
      if (Date.now() < pauseGraceUntil) return;

      clearTimeout(pauseProbeTimer);
      pauseProbeTimer = setTimeout(() => {
        if (internalPause || stopped || !state.running || state.userPaused || finishing) return;
        if (!video || !video.paused || video.ended) return;
        if (document.hidden || !document.hasFocus()) {
          enterAttention('focus');
        } else {
          enterAttention('paused');
        }
      }, 450);
    }

    function onWindowBlur() {
      if (stopped || !state.running || state.userPaused) return;
      setTimeout(() => {
        if (!document.hasFocus()) enterAttention('focus');
      }, 250);
    }

    function onWindowFocus() {
      if (!attentionPaused || attentionReason !== 'focus') return;
      setTimeout(() => {
        if (isPageActive()) resumeFromAttention();
      }, 350);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (stopped || !state.running || state.userPaused) return;
        enterAttention('focus');
        return;
      }
      if (attentionPaused && attentionReason === 'focus' && isPageActive()) {
        setTimeout(() => {
          if (isPageActive()) resumeFromAttention();
        }, 350);
      }
    }

    function enterAttention(reason) {
      if (stopped || !state.running || state.userPaused) return;

      attentionPaused = true;
      attentionReason = reason;
      state.status = 'attention';
      state.userPaused = false;
      clearTimeout(checkTimer);
      clearTimeout(pauseProbeTimer);
      internalPause = true;
      if (video && !video.paused) {
        try { video.pause(); } catch (_) {}
      }
      saveWorkerState();
      updateWorkerUi();

      if (reason === 'focus') {
        setWorkerMessage('视频页失去焦点或切到后台，站点已暂停。请保持视频标签页在前台，队列会自动继续。', 'warn');
      } else {
        setWorkerMessage('播放器已暂停。请点击播放器中的播放按钮，或点本面板的“继续”。', 'warn');
      }
    }

    async function resumeFromAttention() {
      if (stopped || !state.running || state.userPaused) return;
      if (!isPageActive()) {
        setWorkerMessage('请先切回视频标签页并让它保持前台。', 'warn');
        return;
      }

      attentionPaused = false;
      attentionReason = '';
      state.status = 'watching';
      pauseGraceUntil = Date.now() + 2000;
      saveWorkerState();
      const ok = await ensurePlaying();
      if (ok) {
        const speedOk = await ensureTargetSpeed();
        startSpeedGuard();
        scheduleCheck();
        setWorkerMessage(
          speedOk ? '已恢复播放。' : `已恢复播放，但未能切换到 ${targetSpeed.toFixed(2)} 倍速。`,
          speedOk ? 'ok' : 'warn',
        );
      } else {
        enterAttention('paused');
      }
      updateWorkerUi();
    }

    function bindWorkerEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-worker-panel-collapsed');
          return;
        }
        if (action === 'pause') {
          if (!video) return;
          if (video.paused) {
            state.userPaused = false;
            state.status = 'watching';
            saveWorkerState();
            if (attentionPaused) {
              await resumeFromAttention();
            } else {
              await ensurePlaying();
              scheduleCheck();
            }
          } else {
            internalPause = true;
            video.pause();
            state.userPaused = true;
            attentionPaused = false;
            attentionReason = '';
            state.status = 'paused';
            saveWorkerState();
          }
          updateWorkerUi();
          return;
        }
        if (action === 'stop') {
          stopQueue();
          return;
        }
        if (action === 'retry') {
          location.reload();
        }
      });
    }

    async function waitForVideo(timeoutMs) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const found = document.querySelector('video');
        if (found) return found;
        await sleep(500);
      }
      return null;
    }

    async function waitForMetadata(target, timeoutMs) {
      if (Number.isFinite(target.duration) && target.duration > 0) return;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (Number.isFinite(target.duration) && target.duration > 0) return;
        await sleep(300);
      }
    }

    async function ensurePlaying() {
      if (!video) return false;
      if (!video.paused) return true;
      if (!isPageActive()) {
        enterAttention('focus');
        return false;
      }
      try {
        const promise = video.play();
        if (promise && typeof promise.then === 'function') await promise;
        return !video.paused;
      } catch (_) {
        setWorkerMessage('浏览器阻止了自动播放。请在播放器中点一次播放，队列会在开始后继续。', 'warn');
        return false;
      }
    }

    async function ensureTargetSpeed() {
      if (!video) return false;
      if (Math.abs(video.playbackRate - targetSpeed) < 0.01) {
        state.speed = targetSpeed;
        return true;
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        applyTargetSpeedEvents();
        await sleep(400);
        if (Math.abs(video.playbackRate - targetSpeed) < 0.01) {
          state.speed = targetSpeed;
          saveWorkerState();
          return true;
        }
      }

      speedFailures += 1;
      state.speed = video.playbackRate || 1;
      saveWorkerState();
      return false;
    }

    function applyTargetSpeedEvents() {
      const button = document.querySelector('xt-speedbutton');
      if (!button) return;
      const list = button.querySelector('ul');
      if (!list) return;

      let option = button.querySelector('li[data-ykt-speed-option="1"]');
      if (!option) {
        option = button.querySelector('li[data-speed="2"]')
          || button.querySelector('li[data-speed="1"]')
          || button.querySelector('li');
      }
      if (!option) return;

      option.setAttribute('data-ykt-speed-option', '1');
      option.setAttribute('data-speed', String(targetSpeed));
      option.setAttribute('keyt', targetSpeed.toFixed(2));
      option.textContent = `${targetSpeed.toFixed(2)}X`;
      option.classList.remove('xt_video_player_common_active');

      try {
        button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 1000, clientY: 400 }));
        button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1040, clientY: 350 }));
        option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}

      if (!video || Math.abs(video.playbackRate - targetSpeed) >= 0.01) {
        const $ = window.jQuery;
        if ($) {
          try {
            const $button = $('xt-speedbutton');
            $button.trigger($.Event('mouseover', { clientX: 1000, clientY: 400 }));
            $button.trigger($.Event('mousemove', { clientX: 1040, clientY: 350 }));
            $(option).trigger('click');
          } catch (_) {}
        }
      }
    }

    function startSpeedGuard() {
      clearInterval(speedTimer);
      speedTimer = setInterval(async () => {
        if (stopped || !state.running || state.userPaused || !video) return;
        if (Math.abs(video.playbackRate - targetSpeed) > 0.01 && speedFailures < 5) {
          const ok = await ensureTargetSpeed();
          if (!ok) {
            state.speed = video.playbackRate || 1;
            saveWorkerState();
            updateWorkerUi();
          }
        }
      }, 15000);
    }

    function scheduleCheck() {
      clearTimeout(checkTimer);
      if (stopped || !state.running || state.userPaused || attentionPaused || state.status === 'attention') return;

      const target = Number.isFinite(video && video.duration) && video.duration > 0
        ? Math.max(0, video.duration - (video.currentTime || 0))
        : null;
      const rate = video && video.playbackRate > 0 ? video.playbackRate : targetSpeed;
      const waitMs = target == null
        ? 5000
        : Math.max(MIN_CHECK_MS, Math.min(MAX_CHECK_MS, (target / rate + 2) * 1000));

      checkTimer = setTimeout(() => {
        checkProgress().catch(handleFatalError);
      }, waitMs);
    }

    async function checkProgress() {
      if (stopped || !state.running || state.userPaused || finishing || attentionPaused) return;

      if (!video) {
        scheduleCheck();
        return;
      }

      if (video.paused && !video.ended) {
        enterAttention(isPageActive() ? 'paused' : 'focus');
        return;
      }

      const ended = video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 1.5);
      if (!ended) {
        scheduleCheck();
        return;
      }

      finishing = true;
      await confirmCompletion();
    }

    async function confirmCompletion() {
      let serverProgress = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        serverProgress = await getLeafProgress(videoPage.classroomId, item.leafId);
        if (serverProgress != null && serverProgress >= COMPLETE_THRESHOLD) break;
        if (attempt < 4) await sleep(2000);
      }

      if (serverProgress != null && serverProgress >= COMPLETE_THRESHOLD) {
        completeCurrent(serverProgress, false);
        return;
      }

      if (video && video.ended) {
        const detail = serverProgress == null
          ? '平台进度暂时查询不到'
          : `平台进度为 ${pct(serverProgress)}`;
        setWorkerMessage(`${detail}；视频已实际播放到结尾，继续下一条。`, 'warn');
        completeCurrent(serverProgress, true);
        return;
      }

      finishing = false;
      scheduleCheck();
    }

    function completeCurrent(serverProgress, playedToEnd) {
      if (stopped) return;

      const current = state.queue[state.index];
      if (current) {
        current.progress = Math.max(normalizeProgress(current.progress), normalizeProgress(serverProgress));
        current.playedToEnd = !!playedToEnd || current.progress >= COMPLETE_THRESHOLD;
        current.completedAt = Date.now();
      }

      state.serverProgress = normalizeProgress(serverProgress);
      saveState(state);

      const nextIndex = state.index + 1;
      if (nextIndex < state.queue.length) {
        state.index = nextIndex;
        state.status = 'transitioning';
        state.currentLeafId = state.queue[nextIndex].leafId;
        state.currentTitle = state.queue[nextIndex].label;
        state.currentTime = 0;
        state.duration = 0;
        state.serverProgress = 0;
        state.heartbeatAt = Date.now();
        saveState(state);
        updateWorkerUi();
        setWorkerMessage(`已完成，正在打开下一条：${state.queue[nextIndex].title}`, 'ok');
        setTimeout(() => {
          location.replace(withWorkerHash(state.queue[nextIndex].url));
        }, 1600);
        return;
      }

      state.running = false;
      state.status = 'done';
      state.currentLeafId = null;
      state.currentTitle = '';
      state.serverProgress = 0;
      state.heartbeatAt = Date.now();
      saveState(state);
      stopped = true;
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      updateWorkerUi();
      setWorkerMessage('队列已完成：所有待看视频都已处理。', 'ok');
    }

    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (stopped) return;

        const fresh = loadState(videoPage.classroomId);
        if (!fresh || !fresh.running) {
          stopByExternalRequest();
          return;
        }

        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = state.heartbeatAt;
        state.currentLeafId = item.leafId;
        state.currentTitle = item.label;
        state.currentTime = video ? video.currentTime || 0 : state.currentTime;
        state.duration = video && Number.isFinite(video.duration) ? video.duration : state.duration;
        state.speed = video && video.playbackRate ? video.playbackRate : state.speed;
        state.serverProgress = Math.max(
          normalizeProgress(state.serverProgress),
          normalizeProgress(state.queue[state.index] && state.queue[state.index].progress),
        );
        if (state.status === 'error') {
          // Keep the error visible until the page is retried.
        } else if (state.status === 'transitioning') {
          // Keep the transition state until navigation.
        } else if (attentionPaused) {
          state.status = 'attention';
        } else if (state.userPaused) {
          state.status = 'paused';
        } else {
          state.status = 'watching';
        }

        const latest = loadState(videoPage.classroomId);
        if (!latest || !latest.running) {
          stopByExternalRequest();
          return;
        }
        saveState(state);
        updateWorkerUi();
      }, HEARTBEAT_MS);
    }

    function startUiTicker() {
      clearInterval(uiTimer);
      uiTimer = setInterval(updateWorkerUi, 1000);
    }

    function saveWorkerState() {
      if (stopped) return;
      lastStateWrite = Date.now();
      state.heartbeatAt = lastStateWrite;
      state.workerHeartbeatAt = lastStateWrite;
      if (video) {
        state.currentTime = video.currentTime || 0;
        state.duration = Number.isFinite(video.duration) ? video.duration : 0;
        state.speed = video.playbackRate || state.speed;
      }
      saveState(state);
    }

    function stopByExternalRequest() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      clearInterval(speedTimer);
      updateWorkerUi();
      setWorkerMessage('队列已被课程页停止。', 'warn');
    }

    function stopQueue() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      if (channel) {
        channel.postMessage({ type: 'state-changed', classroomId: videoPage.classroomId });
      }
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      clearInterval(speedTimer);
      updateWorkerUi();
      setWorkerMessage('队列已停止。回到课程页可以继续。', 'warn');
    }

    function handleFatalError(error) {
      if (stopped) return;
      state.status = 'error';
      state.running = true;
      state.lastError = truncate(error && error.message ? error.message : error, 160);
      saveState(state);
      updateWorkerUi();
      setWorkerMessage(`播放失败：${state.lastError}`, 'error');
    }

    function updateWorkerUi() {
      enforceAttentionPause();

      if (
        attentionPaused
        && attentionReason === 'focus'
        && isPageActive()
        && !stopped
        && state.running
        && !state.userPaused
        && Date.now() - lastAttentionResumeAttempt > 2500
      ) {
        lastAttentionResumeAttempt = Date.now();
        resumeFromAttention();
      }

      const alive = state.running && !stopped;
      const queuePos = alive ? `第 ${state.index + 1} / ${state.queue.length} 条` : '队列';

      ui.refs.qpos.textContent = queuePos;
      ui.refs.speedLogo.textContent = `${targetSpeed.toFixed(1)}×`;
      ui.refs.title.textContent = item.label;

      const localTime = video ? video.currentTime || 0 : state.currentTime || 0;
      const duration = video && Number.isFinite(video.duration) ? video.duration : state.duration || 0;
      const rate = video && video.playbackRate ? video.playbackRate : state.speed || targetSpeed;
      const remaining = duration > 0 ? Math.max(0, (duration - localTime) / rate) : null;
      const serverProgress = Math.max(
        normalizeProgress(state.serverProgress),
        normalizeProgress(state.queue[state.index] && state.queue[state.index].progress),
      );

      let tone = 'active';
      let statusText = '观看中';
      if (state.status === 'error') {
        tone = 'error';
        statusText = '需要处理';
      } else if (stopped || !state.running) {
        tone = state.status === 'done' ? 'active' : 'idle';
        statusText = state.status === 'done' ? '队列完成' : '已停止';
      } else if (state.status === 'transitioning') {
        tone = 'busy';
        statusText = '正在切换下一条';
      } else if (attentionPaused || state.status === 'attention') {
        tone = 'warn';
        statusText = attentionReason === 'focus' ? '等待回到视频页' : '播放器已暂停';
      } else if (state.userPaused) {
        tone = 'warn';
        statusText = '已暂停';
      } else if (video && video.readyState < 3 && !video.paused) {
        tone = 'busy';
        statusText = '缓冲中';
      } else if (video && video.paused) {
        tone = 'warn';
        statusText = '播放器已暂停';
      }

      ui.refs.status.textContent = statusText;
      ui.refs.dot.className = `dot ${tone}`;
      ui.refs.fill.style.width = `${Math.round(serverProgress * 100)}%`;
      ui.refs.time.textContent = `本地 ${formatTime(localTime)} / ${formatTime(duration)}`;
      ui.refs.pct.textContent = `平台 ${pct(serverProgress)}`;
      ui.refs.meta.textContent = remaining == null
        ? `${Number(rate).toFixed(2)}×`
        : `${Number(rate).toFixed(2)}× · 预计剩余 ${formatTime(remaining)}`;

      const pauseButton = ui.refs.pause;
      pauseButton.hidden = !alive || state.status === 'error';
      pauseButton.textContent = video && video.paused ? '继续' : '暂停';
      pauseButton.disabled = !alive || state.status === 'transitioning';

      ui.refs.stop.hidden = !alive;
      ui.refs.retry.hidden = state.status !== 'error';
    }

    function setWorkerMessage(text, tone = 'ok') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = text;
      box.className = `message ${tone}`;
      box.hidden = false;
      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 15000 : 8000);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function createCoursePanel() {
    const host = document.createElement('div');
    host.id = 'ykt-video-queue-course-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(344px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo">YT</span><span>雨课堂视频队列</span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="summary">
            <div><b data-ref="pending">—</b><span>待看</span></div>
            <div><b data-ref="total">—</b><span>总计</span></div>
            <div><b data-ref="done">—</b><span>已完成</span></div>
          </div>
          <div class="speedRow">
            <span>倍速</span>
            <b class="speedFixed">2.00×</b>
            <small>平台上限，超过会被回滚</small>
          </div>
          <div class="estimate" title="按所选目标倍速、当前进度和每条约 6 秒切换时间估算；未返回时长的视频按平均值估算；不含暂停、缓冲和网络等待">
            <span>预计剩余</span>
            <b data-ref="estimate">计算中…</b>
            <small data-ref="estimateHint">2× · 含切换</small>
          </div>
          <div class="statusline"><span class="dot idle" data-ref="dot"></span><span data-ref="status">正在初始化…</span></div>
          <div class="current" data-ref="current" hidden>
            <div class="currentTitle" data-ref="curTitle"></div>
            <div class="track"><div class="fill" data-ref="curFill"></div></div>
            <div class="meta" data-ref="curMeta"></div>
          </div>
          <div class="actions">
            <button class="primary" data-act="primary" data-ref="primary">读取队列</button>
            <button data-act="refresh" data-ref="refresh">刷新</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <details class="queueBox" data-ref="queueBox" hidden>
            <summary>待看队列 <span data-ref="queueCount"></span></summary>
            <ol class="queueList" data-ref="queueList"></ol>
          </details>
          <div class="hint">会固定在一个新标签页中逐条播放；请保持该标签页前台并聚焦。站点失焦会暂停，脚本不会绕过防挂机检查。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-course-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createWorkerPanel() {
    const host = document.createElement('div');
    host.id = 'ykt-video-queue-worker-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(340px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo accent" data-ref="speedLogo">2.0×</span><span>队列观看中</span><span class="qpos" data-ref="qpos"></span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="statusline"><span class="dot active" data-ref="dot"></span><span data-ref="status">准备播放…</span></div>
          <div class="videoTitle" data-ref="title"></div>
          <div class="track"><div class="fill" data-ref="fill"></div></div>
          <div class="timerow"><span data-ref="time"></span><span data-ref="pct"></span></div>
          <div class="meta" data-ref="meta"></div>
          <div class="actions">
            <button class="primary" data-act="pause" data-ref="pause">暂停</button>
            <button class="danger" data-act="stop" data-ref="stop">停止队列</button>
            <button data-act="retry" data-ref="retry" hidden>重新加载</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <div class="hint">保持本标签页前台并聚焦；失焦会暂停，播放结束后自动进入下一条。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-worker-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function toggleCollapse(ui, storageKeyName) {
    const collapsed = ui.panel.classList.toggle('collapsed');
    const button = ui.shadow.querySelector('[data-act="collapse"]');
    if (button) button.textContent = collapsed ? '+' : '−';
    try {
      sessionStorage.setItem(storageKeyName, collapsed ? '1' : '0');
    } catch (_) {}
  }

  function createChannel() {
    try {
      return new BroadcastChannel(CHANNEL_NAME);
    } catch (_) {
      return null;
    }
  }

  function panelCss() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        width: 100%;
        color: #e9eef8;
        background: rgba(18, 23, 34, 0.97);
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 14px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        overflow: hidden;
        backdrop-filter: blur(12px);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 11px 12px;
        background: rgba(255, 255, 255, 0.045);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        user-select: none;
      }
      .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: .01em; }
      .logo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; border-radius: 7px;
        background: #4f8cff; color: #fff; font-size: 11px; font-weight: 800;
      }
      .logo.accent { background: #25c08a; }
      .qpos { color: #8f9bb0; font-size: 11px; font-weight: 500; margin-left: 2px; }
      .iconBtn {
        appearance: none; border: 0; background: rgba(255,255,255,.08); color: #c9d4e7;
        width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1;
      }
      .iconBtn:hover { background: rgba(255,255,255,.15); }
      .body { padding: 12px; }
      .panel.collapsed .body { display: none; }
      .summary {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;
      }
      .summary > div {
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06);
        border-radius: 10px; padding: 7px 8px; text-align: center;
      }
      .summary b { display: block; font-size: 18px; line-height: 1.2; font-weight: 700; color: #f5f8ff; }
      .summary span { display: block; font-size: 11px; color: #8492a8; margin-top: 2px; }
      .speedRow {
        display: flex; align-items: center; gap: 7px;
        padding: 7px 9px; margin-bottom: 9px;
        border: 1px solid rgba(255,255,255,.08); border-radius: 9px;
        background: rgba(255,255,255,.035);
      }
      .speedRow > span { color: #91a0b5; font-size: 11px; flex: 0 0 auto; }
      .speedFixed { color: #e8eef8; font-size: 12px; font-weight: 650; }
      .speedRow small { color: #74849a; font-size: 10px; margin-left: auto; text-align: right; }
      .estimate {
        display: flex; align-items: baseline; gap: 8px;
        padding: 8px 10px; margin-bottom: 9px;
        border: 1px solid rgba(57,217,138,.2); border-radius: 10px;
        background: rgba(57,217,138,.07);
      }
      .estimate span { color: #8fa4b8; font-size: 11px; flex: 0 0 auto; }
      .estimate b { color: #a8f0cf; font-size: 14px; font-weight: 650; flex: 1; min-width: 0; }
      .estimate small { color: #708097; font-size: 10px; flex: 0 0 auto; }
      .statusline { display: flex; align-items: center; gap: 7px; color: #aebbd0; font-size: 12px; margin: 7px 0 10px; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #6d7a8f; flex: 0 0 auto; }
      .dot.active { background: #39d98a; box-shadow: 0 0 0 3px rgba(57,217,138,.12); }
      .dot.busy { background: #5aa4ff; box-shadow: 0 0 0 3px rgba(90,164,255,.13); }
      .dot.warn { background: #ffc247; box-shadow: 0 0 0 3px rgba(255,194,71,.12); }
      .dot.error { background: #ff6b6b; box-shadow: 0 0 0 3px rgba(255,107,107,.12); }
      .current {
        background: rgba(79,140,255,.09); border: 1px solid rgba(79,140,255,.22);
        border-radius: 11px; padding: 9px 10px; margin-bottom: 10px;
      }
      .currentTitle, .videoTitle {
        color: #f4f7ff; font-weight: 650; font-size: 13px; line-height: 1.4;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .videoTitle { margin: 2px 0 9px; }
      .track { height: 6px; border-radius: 999px; background: rgba(255,255,255,.09); overflow: hidden; margin: 7px 0 5px; }
      .fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4f8cff, #39d98a); border-radius: inherit; transition: width .3s ease; }
      .meta, .timerow { color: #8e9cb2; font-size: 11px; }
      .timerow { display: flex; justify-content: space-between; gap: 8px; }
      .actions { display: flex; gap: 7px; margin-top: 11px; flex-wrap: wrap; }
      button {
        appearance: none; border: 1px solid rgba(255,255,255,.11); background: rgba(255,255,255,.055);
        color: #dce5f5; border-radius: 9px; padding: 7px 12px; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      button:hover:not(:disabled) { background: rgba(255,255,255,.1); }
      button:disabled { opacity: .48; cursor: default; }
      button.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; flex: 1 1 120px; }
      button.primary:hover:not(:disabled) { background: #3f7ef5; }
      button.danger { color: #ffb7b7; border-color: rgba(255,107,107,.28); background: rgba(255,107,107,.08); }
      button.danger:hover:not(:disabled) { background: rgba(255,107,107,.14); }
      .message {
        margin-top: 10px; padding: 8px 10px; border-radius: 9px; font-size: 11.5px; line-height: 1.45;
        background: rgba(79,140,255,.1); border: 1px solid rgba(79,140,255,.22); color: #bdd4ff;
      }
      .message.ok { background: rgba(57,217,138,.09); border-color: rgba(57,217,138,.22); color: #b8f3d8; }
      .message.warn { background: rgba(255,194,71,.09); border-color: rgba(255,194,71,.22); color: #ffe1a1; }
      .message.error { background: rgba(255,107,107,.09); border-color: rgba(255,107,107,.25); color: #ffc4c4; }
      .manualLink { color: #bcd4ff; margin-left: 6px; text-decoration: underline; }
      .queueBox { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.07); padding-top: 8px; }
      .queueBox summary { cursor: pointer; color: #aab7cc; font-size: 12px; user-select: none; }
      .queueList { list-style: none; margin: 7px 0 0; padding: 0; max-height: 220px; overflow: auto; }
      .queueList li {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px;
        border-bottom: 1px solid rgba(255,255,255,.045); color: #d8e1f0;
      }
      .queueList li:last-child { border-bottom: 0; }
      .queueList li.current { background: rgba(79,140,255,.09); border-radius: 6px; }
      .queueList li.done { opacity: .55; }
      .idx { width: 17px; flex: 0 0 auto; color: #718096; font-size: 10px; text-align: right; padding-top: 1px; }
      .itemText { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .itemTitle { color: #e8eef8; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .itemChapter { color: #77859a; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .itemProgress { flex: 0 0 auto; color: #8fc2ff; font-size: 10px; padding-top: 1px; }
      .hint { color: #718096; font-size: 10.5px; line-height: 1.45; margin-top: 10px; }
      @media (max-width: 520px) {
        .panel { border-radius: 12px; }
        .body { padding: 10px; }
      }
    `;
  }
})();
