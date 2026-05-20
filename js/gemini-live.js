/**
 * S4 Gemini Live API 即時語音對話模組
 * 使用 WebSocket 連接 Gemini 2.5 Flash Native Audio
 * 支援即時雙向音訊串流 + Google Search Grounding
 */
(function () {
  'use strict';

  /* ============================
     設定常數
     ============================ */
  const MODEL = 'models/gemini-2.5-flash-native-audio-latest';
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const SAMPLE_RATE = 16000;       // 麥克風輸入取樣率
  const OUTPUT_SAMPLE_RATE = 24000; // Gemini 輸出取樣率
  const CHUNK_INTERVAL_MS = 200;    // 每 200ms 送出一次音訊 chunk

  /* ============================
     狀態
     ============================ */
  let ws = null;
  let mediaStream = null;
  let audioContext = null;
  let scriptProcessor = null;
  let isConnected = false;
  let isRecording = false;
  let audioQueue = [];          // 待播放的 PCM chunks
  let isPlaying = false;
  let playbackContext = null;
  let sendBuffer = [];          // 累積的錄音 buffer
  let sendIntervalId = null;

  // 光暈控制回調（由外部設定）
  let onAiSpeakingStart = null;
  let onAiSpeakingEnd = null;

  /* ============================
     DOM 元素
     ============================ */
  const micBtn = document.getElementById('s4-mic-btn');
  const statusEl = document.getElementById('s4-status');

  /* ============================
     API Key（從 js/config.js 讀取）
     ============================ */
  function getApiKey() {
    const key = window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY;
    if (!key || key === 'YOUR_API_KEY_HERE') {
      console.error('[Gemini Live] 請在 js/config.js 設定 GEMINI_API_KEY');
      return null;
    }
    return key;
  }

  /* ============================
     WebSocket 連接
     ============================ */
  function connect() {
    const key = getApiKey();
    if (!key) {
      setStatus('需要 API Key');
      return;
    }

    setStatus('連線中...');
    ws = new WebSocket(`${WS_URL}?key=${key}`);

    ws.onopen = () => {
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
          tools: [{ googleSearch: {} }]
        }
      };
      ws.send(JSON.stringify(setup));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    };

    ws.onerror = (err) => {
      console.error('[Gemini Live] WebSocket error:', err);
      setStatus('連線錯誤');
      cleanup();
    };

    ws.onclose = () => {
      isConnected = false;
      setStatus('已斷線');
      cleanup();
    };
  }

  /* ============================
     處理伺服器訊息
     ============================ */
  function handleServerMessage(msg) {
    // Setup 完成
    if (msg.setupComplete) {
      isConnected = true;
      setStatus('已連線 — 點擊麥克風開始對話');
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
            // base64 PCM 資料
            const pcmB64 = part.inlineData.data;
            audioQueue.push(pcmB64);
            if (!isPlaying) {
              playNextChunk();
            }
          }
        }
      }

      // 模型生成完成
      if (sc.generationComplete) {
        // 等播放完才觸發 end
      }

      // 回合結束
      if (sc.turnComplete) {
        // AI 說完了 — 光暈會在播放完畢時關閉
      }

      // 被打斷
      if (sc.interrupted) {
        audioQueue = [];
        stopPlayback();
      }
    }
  }

  /* ============================
     音訊播放（AI 回覆）
     ============================ */
  function playNextChunk() {
    if (audioQueue.length === 0) {
      isPlaying = false;
      if (onAiSpeakingEnd) onAiSpeakingEnd();
      return;
    }

    isPlaying = true;
    if (onAiSpeakingStart) onAiSpeakingStart();

    if (!playbackContext) {
      playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
    }

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
    source.onended = () => {
      playNextChunk();
    };
    source.start();
  }

  function stopPlayback() {
    isPlaying = false;
    if (onAiSpeakingEnd) onAiSpeakingEnd();
  }

  /* ============================
     麥克風錄音 + 送出
     ============================ */
  async function startRecording() {
    if (!isConnected) {
      connect();
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true }
      });
    } catch (e) {
      setStatus('無法存取麥克風');
      console.error('[Gemini Live] Mic error:', e);
      return;
    }

    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    // 使用 ScriptProcessorNode 取得 PCM（相容性佳）
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      if (!isRecording) return;
      const float32 = e.inputBuffer.getChannelData(0);
      // 轉成 16-bit PCM
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      sendBuffer.push(pcm16);
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    isRecording = true;
    micBtn.classList.add('recording');
    setStatus('錄音中...');

    // 定期送出音訊 chunk
    sendIntervalId = setInterval(() => {
      if (sendBuffer.length === 0) return;
      // 合併所有 buffer
      let totalLen = 0;
      for (const buf of sendBuffer) totalLen += buf.length;
      const merged = new Int16Array(totalLen);
      let offset = 0;
      for (const buf of sendBuffer) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      sendBuffer = [];

      // 送出 realtimeInput
      const b64 = arrayBufferToBase64(merged.buffer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=' + SAMPLE_RATE,
              data: b64
            }
          }
        }));
      }
    }, CHUNK_INTERVAL_MS);
  }

  function stopRecording() {
    isRecording = false;
    micBtn.classList.remove('recording');
    setStatus('處理中...');

    if (sendIntervalId) {
      clearInterval(sendIntervalId);
      sendIntervalId = null;
    }

    // 送出剩餘 buffer
    if (sendBuffer.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
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
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=' + SAMPLE_RATE,
            data: b64
          }
        }
      }));
    }

    // 通知音訊串流結束
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        realtimeInput: { audioStreamEnd: true }
      }));
    }

    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  /* ============================
     清理
     ============================ */
  function cleanup() {
    stopRecording();
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
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
     事件綁定
     ============================ */
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  }

  /* ============================
     對外介面（供 slideshow.js 光暈控制使用）
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
