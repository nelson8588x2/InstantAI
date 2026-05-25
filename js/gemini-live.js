/**
 * S4 Gemini Live API 即時語音對話模組
 * 使用 WebSocket 連接 Gemini 2.5 Flash Native Audio
 * 支援即時雙向音訊串流 + Google Search Grounding
 *
 * 無按鈕設計：切換到 S4 時自動連線並開始串流麥克風
 * 頁面載入時即預先取得麥克風權限
 */
(function () {
  'use strict';

  /* ============================
     設定常數
     ============================ */
  const MODEL = 'models/gemini-2.5-flash-native-audio-latest';
  // 透過後端 WebSocket 代理連線（API Key 安全存放於伺服器端）
  const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/gemini-live';
  const SAMPLE_RATE = 16000;       // 麥克風輸入取樣率
  const OUTPUT_SAMPLE_RATE = 24000; // Gemini 輸出取樣率
  const CHUNK_INTERVAL_MS = 200;    // 每 200ms 送出一次音訊 chunk

  /* ============================
     狀態
     ============================ */
  let ws = null;
  let mediaStream = null;
  let audioContext = null;
  let isConnected = false;
  let isRecording = false;
  let audioQueue = [];          // 待播放的 PCM chunks
  let isPlaying = false;
  let playbackContext = null;
  let playbackScheduledTime = 0;  // 精確排程播放時間
  let sendBuffer = [];          // 累積的錄音 buffer
  let sendIntervalId = null;
  let micPermissionGranted = false;

  // 自動重連相關
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 1000; // 1 秒起始
  let reconnectTimerId = null;
  let shouldReconnect = false; // 是否應該在斷線後嘗試重連（僅在 S4 活躍時）

  // 光暈控制回調（由外部設定）
  let onAiSpeakingStart = null;
  let onAiSpeakingEnd = null;
  // 音量回調：fn(volume: 0~1, source: 'mic'|'ai')
  let onVolumeUpdate = null;

  // 音量分析節點
  let micAnalyser = null;
  let aiAnalyser = null;
  let volumeRafId = null;

  /* ============================
     DOM 元素
     ============================ */
  const statusEl = document.getElementById('s4-status');

  /* ============================
     頁面載入時預先取得麥克風權限
     ============================ */
  async function requestMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true }
      });
      // 取得權限後立即停止（僅確認權限）
      stream.getTracks().forEach(t => t.stop());
      micPermissionGranted = true;
      console.log('[Gemini Live] 麥克風權限已取得');
    } catch (e) {
      micPermissionGranted = false;
      console.warn('[Gemini Live] 麥克風權限被拒絕:', e);
    }
  }

  // 頁面載入後立即詢問麥克風權限
  requestMicPermission();

  /* ============================
     WebSocket 連接（透過後端代理）
     ============================ */
  function connect() {
    if (isConnected || (ws && ws.readyState === WebSocket.CONNECTING)) return;

    shouldReconnect = true;
    setStatus('連線中...');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[Gemini Live] WS 已連線，送出 setup...');
      // 送出 setup 訊息
      const setup = {
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Rasalgethi'
                }
              }
            }
          },
          tools: [{ googleSearch: {} }],
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 100,
              silenceDurationMs: 500
            },
            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
            turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
          }
        }
      };
      const setupStr = JSON.stringify(setup);
      console.log('[Gemini Live] Setup payload:', setupStr.substring(0, 300));
      ws.send(setupStr);
    };

    ws.onmessage = async (event) => {
      try {
        // 處理可能收到的 Blob 或 string
        const text = (event.data instanceof Blob)
          ? await event.data.text()
          : event.data;
        const msg = JSON.parse(text);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('[Gemini Live] 無法解析訊息:', e);
      }
    };

    ws.onerror = (err) => {
      console.error('[Gemini Live] WebSocket error:', err);
      setStatus('連線錯誤');
    };

    ws.onclose = (event) => {
      const wasConnected = isConnected;
      isConnected = false;
      isRecording = false;
      stopStreaming();
      console.log('[Gemini Live] WS closed, code:', event.code, 'reason:', event.reason);
      if (wasConnected) setStatus('已斷線');
      // 自動重連（僅當仍在 S4 頁面且非手動 cleanup 關閉）
      scheduleReconnect();
    };
  }

  /* ============================
     自動重連邏輯（指數退避）
     ============================ */
  function scheduleReconnect() {
    if (!shouldReconnect) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('重連失敗，請重新切換 Script 4');
      console.warn('[Gemini Live] 已達最大重連次數，停止重試');
      return;
    }
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    console.log(`[Gemini Live] ${delay}ms 後自動重連（第 ${reconnectAttempts} 次）`);
    setStatus(`重連中 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    reconnectTimerId = setTimeout(() => {
      reconnectTimerId = null;
      if (shouldReconnect) connect();
    }, delay);
  }

  function cancelReconnect() {
    if (reconnectTimerId) {
      clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    reconnectAttempts = 0;
  }

  /* ============================
     處理伺服器訊息
     ============================ */
  function handleServerMessage(msg) {
    // debug: 顯示收到的訊息 key
    const keys = Object.keys(msg);
    console.log('[Gemini Live] 收到訊息, keys:', keys.join(', '));

    // 錯誤訊息
    if (msg.error) {
      setStatus('伺服器錯誤');
      console.error('[Gemini Live] Server error:', msg.error);
      return;
    }

    // Setup 完成 → 自動開始錄音串流
    if (msg.setupComplete) {
      isConnected = true;
      reconnectAttempts = 0; // 連線成功，重置重連計數
      console.log('[Gemini Live] Setup 完成，開始串流錄音...');
      setStatus('對話中');
      startStreaming();
      return;
    }

    // 伺服器內容（音訊回覆）
    if (msg.serverContent) {
      const sc = msg.serverContent;

      // 模型音訊輸出
      if (sc.modelTurn && sc.modelTurn.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData && part.inlineData.mimeType &&
              part.inlineData.mimeType.startsWith('audio/')) {
            const pcmB64 = part.inlineData.data;
            audioQueue.push(pcmB64);
            drainAudioQueue();
          }
        }
      }

      // 被打斷
      if (sc.interrupted) {
        audioQueue = [];
        stopPlayback();
      }
    }
  }

  /* ============================
     音訊播放（AI 回覆）- 精確排程避免間隙
     ============================ */
  function drainAudioQueue() {
    if (!playbackContext) {
      playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    if (playbackContext.state === 'suspended') {
      playbackContext.resume();
    }

    // AI 播放音量分析節點（懶初始化）
    if (!aiAnalyser && playbackContext) {
      aiAnalyser = playbackContext.createAnalyser();
      aiAnalyser.fftSize = 256;
      aiAnalyser.connect(playbackContext.destination);
    }

    while (audioQueue.length > 0) {
      const pcmB64 = audioQueue.shift();
      const pcmBytes = base64ToArrayBuffer(pcmB64);
      const pcm16 = new Int16Array(pcmBytes);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
      }

      const buffer = playbackContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      // 透過 aiAnalyser 節點連接到輸出（既播放又可分析音量）
      if (aiAnalyser) {
        source.connect(aiAnalyser);
      } else {
        source.connect(playbackContext.destination);
      }

      // 精確排程：每個 buffer 接在前一個結束時開始，無間隙
      const now = playbackContext.currentTime;
      if (playbackScheduledTime < now) playbackScheduledTime = now;
      source.start(playbackScheduledTime);
      playbackScheduledTime += buffer.duration;

      if (!isPlaying) {
        isPlaying = true;
        if (onAiSpeakingStart) onAiSpeakingStart();
      }

      // 最後一個 source 結束時檢查是否還有更多
      source.onended = () => {
        if (audioQueue.length > 0) {
          drainAudioQueue();
        } else if (playbackContext.currentTime >= playbackScheduledTime - 0.01) {
          isPlaying = false;
          if (onAiSpeakingEnd) onAiSpeakingEnd();
        }
      };
    }
  }

  function stopPlayback() {
    isPlaying = false;
    playbackScheduledTime = 0;
    if (onAiSpeakingEnd) onAiSpeakingEnd();
  }

  /* ============================
     音量分析迴圈（requestAnimationFrame）
     偵測麥克風 / AI 播放的即時音量
     ============================ */
  function startVolumeLoop() {
    if (volumeRafId) return; // 已在跑
    const micData = new Uint8Array(micAnalyser ? micAnalyser.frequencyBinCount : 128);
    const aiData  = new Uint8Array(128);

    function loop() {
      volumeRafId = requestAnimationFrame(loop);
      if (!onVolumeUpdate) return;

      // 麥克風音量
      if (micAnalyser && isRecording) {
        micAnalyser.getByteFrequencyData(micData);
        let sum = 0;
        for (let i = 0; i < micData.length; i++) sum += micData[i];
        const micVol = Math.min(sum / micData.length / 128, 1);
        onVolumeUpdate(micVol, 'mic');
      }

      // AI 播放音量
      if (aiAnalyser && isPlaying) {
        aiAnalyser.getByteFrequencyData(aiData);
        let sum = 0;
        for (let i = 0; i < aiData.length; i++) sum += aiData[i];
        const aiVol = Math.min(sum / aiData.length / 128, 1);
        onVolumeUpdate(aiVol, 'ai');
      }
    }
    loop();
  }

  function stopVolumeLoop() {
    if (volumeRafId) {
      cancelAnimationFrame(volumeRafId);
      volumeRafId = null;
    }
  }

  /* ============================
     自動開始串流錄音（連線成功後呼叫）
     使用 AudioWorkletNode 取代已棄用的 ScriptProcessorNode
     ============================ */
  let workletNode = null;

  async function startStreaming() {
    if (isRecording) return;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      setStatus('無法存取麥克風');
      console.error('[Gemini Live] Mic error:', e);
      return;
    }

    if (!audioContext) {
      // 使用瀏覽器原生取樣率（通常 48kHz），避免 Chrome 在非原生取樣率下 MediaStreamSource 輸出全零
      // pcm-processor.js 會負責降採樣到 16kHz
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 確保 AudioContext 是 running 狀態
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // 載入 AudioWorklet processor
    try {
      await audioContext.audioWorklet.addModule('js/pcm-processor.js');
    } catch (e) {
      // 可能已經載入過，忽略重複載入錯誤
      if (!e.message.includes('already been added')) {
        console.warn('[Gemini Live] AudioWorklet load warning:', e);
      }
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
    workletNode.port.onmessage = (e) => {
      if (!isRecording) return;
      const pcm16 = new Int16Array(e.data);
      sendBuffer.push(pcm16);
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    // 麥克風音量分析（不影響錄音路徑，僅供視覺化）
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    source.connect(micAnalyser);
    startVolumeLoop();

    isRecording = true;

    // 定期送出音訊 chunk（JSON + base64）
    sendIntervalId = setInterval(() => {
      if (sendBuffer.length === 0) return;
      let totalLen = 0;
      for (const buf of sendBuffer) totalLen += buf.length;
      const merged = new Int16Array(totalLen);
      let offset = 0;
      for (const buf of sendBuffer) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      sendBuffer = [];

      const b64 = arrayBufferToBase64(merged.buffer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm',
              data: b64
            }
          }
        }));
      }
    }, CHUNK_INTERVAL_MS);
  }

  /* ============================
     停止串流
     ============================ */
  function stopStreaming() {
    isRecording = false;

    if (sendIntervalId) {
      clearInterval(sendIntervalId);
      sendIntervalId = null;
    }

    if (workletNode) {
      workletNode.disconnect();
      workletNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    sendBuffer = [];
  }

  /* ============================
     清理（離開 S4 時呼叫）
     ============================ */
  function cleanup() {
    shouldReconnect = false; // 停止自動重連
    cancelReconnect();
    stopStreaming();
    stopVolumeLoop();
    audioQueue = [];
    stopPlayback();
    micAnalyser = null;
    aiAnalyser = null;
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
    setStatus('');
  }

  /* ============================
     工具函式
     ============================ */
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /* ============================
     對外介面（供 slideshow.js 使用）
     ============================ */
  window.geminiLive = {
    connect,
    cleanup,
    get isConnected() { return isConnected; },
    get isRecording() { return isRecording; },
    get isPlaying() { return isPlaying; },
    set onAiSpeakingStart(fn) { onAiSpeakingStart = fn; },
    set onAiSpeakingEnd(fn) { onAiSpeakingEnd = fn; },
    set onVolumeUpdate(fn) { onVolumeUpdate = fn; }
  };

})();
