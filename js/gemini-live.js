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
  let clientMsgCount = 0;

  // 光暈控制回調（由外部設定）
  let onAiSpeakingStart = null;
  let onAiSpeakingEnd = null;

  /* ============================
     裝置變更監聽（耳機插拔）
     ============================ */
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('[Gemini Live] 偵測到音訊裝置變更（耳機插拔）');
    if (isRecording && isConnected) {
      await restartMicStream();
    }
  });

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
      console.log('[Gemini Live] WS closed, code:', event.code, 'reason:', event.reason);
      if (wasConnected) setStatus('已斷線');
    };
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
      source.connect(playbackContext.destination);

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
     取得可用麥克風（自動跳過 muted 的裝置）
     ============================ */
  async function getWorkingMic() {
    const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

    // 先嘗試預設麥克風
    let stream = await navigator.mediaDevices.getUserMedia(constraints);
    let track = stream.getAudioTracks()[0];
    console.log(`[Gemini Live] 預設麥克風: ${track.label}, muted=${track.muted}`);

    if (!track.muted) return stream;

    // 預設麥克風 muted（可能是 USB DAC 沒有 mic），嘗試其他裝置
    console.log('[Gemini Live] 預設麥克風 muted，嘗試其他裝置...');
    stream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    console.log(`[Gemini Live] 可用麥克風裝置: ${audioInputs.map(d => d.label).join(', ')}`);

    for (const device of audioInputs) {
      try {
        const altStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: device.deviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        const altTrack = altStream.getAudioTracks()[0];
        console.log(`[Gemini Live] 嘗試: ${altTrack.label}, muted=${altTrack.muted}`);
        if (!altTrack.muted) {
          console.log(`[Gemini Live] 使用替代麥克風: ${altTrack.label}`);
          return altStream;
        }
        altStream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn(`[Gemini Live] 裝置 ${device.label} 無法使用:`, e);
      }
    }

    // 都不行，返回預設的（至少有 stream 物件）
    console.warn('[Gemini Live] 所有麥克風都 muted，使用預設');
    return await navigator.mediaDevices.getUserMedia(constraints);
  }

  /* ============================
     自動開始串流錄音（連線成功後呼叫）
     使用 AudioWorkletNode 取代已棄用的 ScriptProcessorNode
     ============================ */
  let workletNode = null;

  async function startStreaming() {
    if (isRecording) return;

    try {
      mediaStream = await getWorkingMic();
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

    // 診斷：檢查 MediaStream track 和 AudioContext 狀態
    const track = mediaStream.getAudioTracks()[0];
    console.log(`[Gemini Live] Track: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}, label=${track.label}`);
    console.log(`[Gemini Live] AudioContext: state=${audioContext.state}, sampleRate=${audioContext.sampleRate}`);
    const settings = track.getSettings();
    console.log(`[Gemini Live] Track settings:`, JSON.stringify(settings));

    // 診斷：用 AnalyserNode 直接檢測原始音訊能量
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const diagBuf = new Float32Array(analyser.fftSize);
    let diagCount = 0;
    const diagInterval = setInterval(() => {
      analyser.getFloatTimeDomainData(diagBuf);
      let maxVal = 0;
      for (let i = 0; i < diagBuf.length; i++) {
        const v = Math.abs(diagBuf[i]);
        if (v > maxVal) maxVal = v;
      }
      diagCount++;
      if (diagCount <= 10 || diagCount % 30 === 0) {
        console.log(`[Gemini Live] Analyser peak=${maxVal.toFixed(6)}, ctx.state=${audioContext.state}`);
      }
      if (diagCount >= 60) clearInterval(diagInterval);
    }, 500);

    isRecording = true;
    console.log(`[Gemini Live] 錄音已啟動, AudioContext sampleRate=${audioContext.sampleRate}`);

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

      // 計算 RMS 音量（診斷用）
      let sumSq = 0;
      for (let i = 0; i < merged.length; i++) sumSq += merged[i] * merged[i];
      const rms = Math.sqrt(sumSq / merged.length);

      const b64 = arrayBufferToBase64(merged.buffer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm',
              data: b64
            }
          }
        });
        ws.send(msg);
        clientMsgCount++;
        if (clientMsgCount <= 5 || clientMsgCount % 30 === 0) {
          console.log(`[Gemini Live] chunk #${clientMsgCount}: ${merged.length} samples, RMS=${rms.toFixed(0)}, payload=${msg.length} bytes`);
        }
      }
    }, CHUNK_INTERVAL_MS);
  }

  /* ============================
     重新取得麥克風（裝置變更時）
     ============================ */
  let micSource = null;

  async function restartMicStream() {
    console.log('[Gemini Live] 重新取得麥克風...');
    // 停止舊的 track
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
    }
    try {
      mediaStream = await getWorkingMic();

      // 重新連接到 AudioWorklet
      if (workletNode) workletNode.disconnect();
      if (micSource) micSource.disconnect();

      micSource = audioContext.createMediaStreamSource(mediaStream);
      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      workletNode.port.onmessage = (e) => {
        if (!isRecording) return;
        const pcm16 = new Int16Array(e.data);
        sendBuffer.push(pcm16);
      };
      micSource.connect(workletNode);
      workletNode.connect(audioContext.destination);

      const track = mediaStream.getAudioTracks()[0];
      console.log(`[Gemini Live] 麥克風已重新連接: enabled=${track.enabled}, muted=${track.muted}, label=${track.label}`);
    } catch (e) {
      console.error('[Gemini Live] 重新取得麥克風失敗:', e);
    }
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
    stopStreaming();
    audioQueue = [];
    stopPlayback();
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
    set onAiSpeakingStart(fn) { onAiSpeakingStart = fn; },
    set onAiSpeakingEnd(fn) { onAiSpeakingEnd = fn; }
  };

})();
