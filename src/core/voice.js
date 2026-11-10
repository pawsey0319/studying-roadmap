/**
 * One press-to-record interaction at a time. All browser dependencies are injectable.
 * State: idle → requesting → recording → processing → idle. `processing` includes
 * waiting for MediaRecorder's final data/stop events and the onComplete promise.
 * start resolves true when recording starts, false when cancelled/rejected/failed;
 * release/cancel return whether they acted. Errors are delivered to onError with
 * codes BUSY, UNSUPPORTED, MAX_DURATION, MAX_BYTES, EMPTY_AUDIO,
 * PROCESSING_TIMEOUT or RECORDING_ERROR.
 */
export function createVoiceController({
  getUserMedia = constraints => globalThis.navigator.mediaDevices.getUserMedia(constraints),
  Recorder = globalThis.MediaRecorder,
  onState = () => {},
  onComplete = () => {},
  onError = () => {},
  maxMs = 60000,
  maxBytes = 10 * 1024 * 1024,
  processingTimeoutMs = 120000,
} = {}) {
  if (![maxMs, maxBytes, processingTimeoutMs].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('maxMs, maxBytes and processingTimeoutMs must be positive finite numbers');
  }
  let state = 'idle';
  let current = null;
  const changeState = value => {
    state = value;
    onState(value);
  };
  const error = (code, message, cause) => Object.assign(new Error(message), { code, cause });
  const stopTracks = stream => {
    for (const track of stream?.getTracks() || []) {
      try { track.stop(); } catch { /* Continue stopping the remaining tracks. */ }
    }
  };
  const clearTimer = operation => {
    clearTimeout(operation.timer);
    operation.timer = null;
  };
  const detach = operation => {
    if (!operation.recorder) return;
    operation.recorder.ondataavailable = null;
    operation.recorder.onstop = null;
    operation.recorder.onerror = null;
  };
  const clean = operation => {
    clearTimer(operation);
    detach(operation);
    if (operation.stream) {
      stopTracks(operation.stream);
      operation.stream = null;
    }
    operation.chunks = [];
  };
  const cancel = () => {
    const operation = current;
    if (!operation) return false;
    current = null; // Invalidate callbacks before stop() can emit synchronously.
    operation.abort.abort();
    clean(operation);
    try {
      if (operation.recorder && operation.recorder.state !== 'inactive') operation.recorder.stop();
    } catch { /* Cancellation must remain silent. */ }
    changeState('idle');
    return true;
  };
  const fail = (operation, failure) => {
    if (current !== operation) return;
    cancel();
    onError(failure instanceof Error ? failure : error('RECORDING_ERROR', '录音失败', failure));
  };
  const finish = async operation => {
    if (current !== operation || !operation.released || operation.completed) return;
    operation.completed = true;
    const mime = operation.recorder.mimeType || operation.chunks.find(chunk => chunk.type)?.type || '';
    const blob = new Blob(operation.chunks, { type: mime });
    operation.chunks = [];
    if (!blob.size) {
      fail(operation, error('EMPTY_AUDIO', '录音为空，请重试'));
      return;
    }
    if (blob.size > maxBytes) {
      fail(operation, error('MAX_BYTES', '录音超过大小限制'));
      return;
    }
    detach(operation);
    try {
      await onComplete(blob, {
        ...operation.context,
        durationMs: operation.durationMs,
        signal: operation.abort.signal,
      });
    } catch (failure) {
      if (current === operation && !operation.abort.signal.aborted) {
        fail(operation, failure);
      }
    } finally {
      clean(operation);
      if (current === operation) {
        current = null;
        changeState('idle');
      }
    }
  };
  const start = async ({ mode, sessionKey } = {}) => {
    if (current) {
      onError(error('BUSY', '录音或语音处理尚未结束'));
      return false;
    }
    if (typeof Recorder !== 'function' || typeof getUserMedia !== 'function') {
      onError(error('UNSUPPORTED', '当前环境不支持录音'));
      return false;
    }
    const operation = {
      context: { mode, sessionKey }, abort: new AbortController(), chunks: [],
      bytes: 0, stream: null, recorder: null, timer: null, released: false,
    };
    current = operation;
    changeState('requesting');
    try {
      const stream = await getUserMedia({ audio: true });
      if (current !== operation) {
        stopTracks(stream);
        return false;
      }
      operation.stream = stream;
      const recorder = operation.recorder = new Recorder(stream);
      recorder.ondataavailable = event => {
        if (current !== operation || !event.data?.size) return;
        operation.bytes += event.data.size;
        if (operation.bytes > maxBytes) {
          fail(operation, error('MAX_BYTES', '录音超过大小限制'));
        } else {
          operation.chunks.push(event.data);
        }
      };
      recorder.onerror = event => fail(operation, event.error || error('RECORDING_ERROR', '录音失败'));
      recorder.onstop = () => {
        if (current !== operation) return;
        if (!operation.released) {
          fail(operation, error('RECORDING_ERROR', '录音意外停止，请重试'));
          return;
        }
        void finish(operation);
      };
      operation.startedAt = Date.now();
      recorder.start();
      if (current !== operation) return false;
      changeState('recording');
      if (current !== operation) return false;
      if (state !== 'recording') return true;
      operation.timer = setTimeout(() => {
        fail(operation, error('MAX_DURATION', '录音超过最长时限，请重新录制'));
      }, maxMs);
      return true;
    } catch (failure) {
      fail(operation, failure);
      return false;
    }
  };
  const release = () => {
    const operation = current;
    if (!operation || operation.released) return false;
    if (state === 'requesting') return cancel();
    if (state !== 'recording') return false;
    operation.released = true;
    operation.durationMs = Math.max(0, Date.now() - operation.startedAt);
    clearTimer(operation);
    if (operation.durationMs > maxMs) {
      fail(operation, error('MAX_DURATION', '录音超过最长时限，请重新录制'));
      return true;
    }
    changeState('processing');
    if (current !== operation) return true;
    // Reuse the operation's timer so every cleanup path clears either deadline.
    operation.timer = setTimeout(() => {
      fail(operation, error('PROCESSING_TIMEOUT', '语音处理超时，请重试'));
    }, processingTimeoutMs);
    try {
      operation.recorder.stop();
    } catch (failure) {
      fail(operation, failure);
    } finally {
      if (operation.stream) {
        stopTracks(operation.stream);
        operation.stream = null;
      }
    }
    return true;
  };
  return { start, release, cancel, get busy() { return state !== 'idle'; }, get state() { return state; } };
}
