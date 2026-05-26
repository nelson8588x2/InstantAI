/**
 * 多 Script 簡報控制邏輯
 * 支援 Script 1~4，每個 Script 有各自的頁面、動畫、音效
 */
(function () {
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const pageIndicator = document.getElementById('page-indicator');

  let currentScript = '0';
  let currentIndex = 0;
  let isAnimating = false;
  let glowAnimFrameId = null;

  // 全域計時器管理器：記錄所有動畫用的 setTimeout ID
  let animTimeouts = [];

  /**
   * 自訂 timeout 函式，取代 setTimeout，可統一清除
   */
  function setAnimTimeout(callback, delay) {
    const id = setTimeout(callback, delay);
    animTimeouts.push(id);
    return id;
  }

  /**
   * 切換頁面時清除所有尚未執行的排程動畫
   */
  function clearAllAnimTimeouts() {
    animTimeouts.forEach(id => clearTimeout(id));
    animTimeouts = [];
  }

  /* ============================
     取得目前 Script 的 DOM 元素
     ============================ */
  function getActiveContainer() {
    return document.querySelector(`.script-container[data-script="${currentScript}"]`);
  }

  function getSlides() {
    const c = getActiveContainer();
    return c ? c.querySelectorAll('.slide') : [];
  }

  function getPillPages() {
    const c = getActiveContainer();
    return c ? c.querySelectorAll('.pill-page') : [];
  }

  function getPillGlow() {
    const c = getActiveContainer();
    return c ? c.querySelector('.pill-glow') : null;
  }

  /* ============================
     音效工具
     ============================ */

  /**
   * 安全播放音效，回傳 audio element 或 null
   */
  function playAudio(id) {
    const audio = document.getElementById(id);
    if (audio && audio.querySelector('source')) {
      audio.currentTime = 0;
      // 如果有 VOLUME_MAP 設定且尚未連接 Web Audio，先建立連接
      if (VOLUME_MAP[id] && !audio._sourceNode && audioContext) {
        audio._sourceNode = audioContext.createMediaElementSource(audio);
        const gain = getGainNode(audio);
        if (gain) {
          audio._sourceNode.connect(gain);
          gain.connect(audioContext.destination);
        } else {
          audio._sourceNode.connect(audioContext.destination);
        }
      }
      audio.play().catch(() => {});
      return audio;
    }
    return null;
  }

  /**
   * 停止音效
   */
  function stopAudio(id) {
    const audio = document.getElementById(id);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  /* ============================
     光效與音量連動
     ============================ */

  let audioContext = null;
  let analyser = null;
  let glowAudioEl = null; // 當前連接光效的 audio element

  /* 音量標準化表（基於 RMS 分析，目標 RMS ≈ 3800，增益上限 1.2） */
  const VOLUME_MAP = {
    's1-sfx-voice-greeting':       1.08,  // RMS 3518
    's1-sfx-voice-transition-p2p3': 1.13, // RMS 3373
    's1-sfx-voice-page3-first':    1.11,  // RMS 3429
    's1-sfx-voice-page3-second':   0.78,  // RMS 4887
    's1-sfx-voice-page3-third':    0.91,  // RMS 4179
    's1-sfx-voice-page3-closing':  0.65,  // RMS 5879
    's1-sfx-voice-page4':          0.88,  // RMS 4326
    's2-sfx-voice-greeting-1':     1.20,  // RMS 待校準（拆分音檔）
    's2-sfx-voice-greeting-2':     1.20,  // RMS 待校準（拆分音檔）
    's2-sfx-voice-details-q':      0.88,  // RMS 4294
    's2-sfx-voice-page3-1':        0.93,  // RMS 待校準（拆分音檔）
    's2-sfx-voice-page3-2':        0.93,  // RMS 待校準（拆分音檔）
    's2-sfx-voice-calendar-q':     1.20,  // RMS 2886（偏小，拉高）
    's2-sfx-voice-page4':          1.05,  // RMS 3614
    's2-sfx-voice-anything-else':  0.61,  // RMS 6276（最大聲）
    's2-sfx-voice-page5':          1.12,  // RMS 3402
    's3-sfx-voice-part1':          1.09,  // RMS 3489
    's3-sfx-voice-part2':          1.20,  // RMS 3128
    's3-sfx-voice-part3':          1.14,  // RMS 3333
    's3-sfx-voice-anything-else':  1.13,  // RMS 3373
    's3-sfx-voice-part4':          1.05,  // RMS 3625
  };

  /**
   * 取得音訊的標準化增益節點（每個 source 專屬，只建立一次）
   */
  function getGainNode(audioEl) {
    if (!audioContext) return null;
    if (!audioEl._gainNode) {
      audioEl._gainNode = audioContext.createGain();
      const vol = VOLUME_MAP[audioEl.id] || 0.85;
      audioEl._gainNode.gain.value = vol;
    }
    return audioEl._gainNode;
  }

  /**
   * 將 audio 元素連接到 Web Audio API，用 analyser 取得音量
   */
  function startGlowWithAudio(audioEl) {
    const pillGlow = getPillGlow();
    if (!pillGlow) return;
    pillGlow.classList.add('active');

    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    // 先清理舊的 analyser
    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    if (!audioEl._sourceNode) {
      audioEl._sourceNode = audioContext.createMediaElementSource(audioEl);
    }

    // 斷開舊的所有連線再重新接
    try { audioEl._sourceNode.disconnect(); } catch (e) {}
    const gain = getGainNode(audioEl);
    if (gain) {
      try { gain.disconnect(); } catch (e) {}
      // source → gain → analyser → destination
      audioEl._sourceNode.connect(gain);
      gain.connect(analyser);
    } else {
      audioEl._sourceNode.connect(analyser);
    }
    analyser.connect(audioContext.destination);

    glowAudioEl = audioEl;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function updateGlow() {
      if (!analyser) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const normalized = Math.min(avg / 128, 1);
      pillGlow.style.opacity = 0.3 + normalized * 0.7;
      glowAnimFrameId = requestAnimationFrame(updateGlow);
    }

    updateGlow();
  }

  /**
   * 停止光效（保持 source → destination 連接，避免音訊靜音）
   */
  function stopGlow() {
    if (glowAnimFrameId) {
      cancelAnimationFrame(glowAnimFrameId);
      glowAnimFrameId = null;
    }
    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }
    // 恢復 source → gain → destination 連接，讓音訊繼續播放
    if (glowAudioEl && glowAudioEl._sourceNode && audioContext) {
      try {
        glowAudioEl._sourceNode.disconnect();
        const gain = getGainNode(glowAudioEl);
        if (gain) {
          glowAudioEl._sourceNode.connect(gain);
          gain.connect(audioContext.destination);
        } else {
          glowAudioEl._sourceNode.connect(audioContext.destination);
        }
      } catch (e) { /* 忽略已斷開的錯誤 */ }
    }
    glowAudioEl = null;
    const pillGlow = getPillGlow();
    if (pillGlow) {
      pillGlow.classList.remove('active');
      pillGlow.style.opacity = '';
    }
  }

  /**
   * 播放 bloop 音效
   */
  function playBloop() {
    const bloopEl = document.getElementById('sfx-bloop');
    if (bloopEl) {
      bloopEl.currentTime = 0;
      bloopEl.play().catch(() => {});
    }
  }

  /* ============================
     提詞機 + 下一頁按鈕光暈
     ============================ */
  const prompterEl = document.getElementById('prompter');
  const btnNextEl = document.getElementById('btn-next');

  // 各 Script / 各頁動畫完成後要顯示的提詞（null = 不顯示）
  const PROMPTER_MAP = {
    '1': {
      0: 'Hey Gemini!',
      1: 'Please do my morning brief.',
      2: 'No, that\'s all for now, thanks.',
    },
    '2': {
      0: null,
      1: 'Sure.',
      2: 'Yes, please.',
      3: 'No, Thank you.',
    },
    '3': {
      0: 'Hey Gemini, Tell me about my mockup plan.',
      1: 'That\'s all. Thanks Gemini.',
    },
  };

  /**
   * 顯示提詞 + 啟動下一頁按鈕呼吸燈
   */
  function showPrompter(text) {
    if (!prompterEl || !text) return;
    prompterEl.textContent = text;
    prompterEl.classList.add('visible');
    if (btnNextEl) btnNextEl.classList.add('glow-hint');
  }

  /**
   * 隱藏提詞 + 停止下一頁按鈕呼吸燈
   */
  function hidePrompter() {
    if (prompterEl) {
      prompterEl.classList.remove('visible');
      prompterEl.textContent = '';
    }
    if (btnNextEl) btnNextEl.classList.remove('glow-hint');
  }

  /**
   * 根據當前 Script + 頁面索引，嘗試顯示提詞（若有配置）
   */
  function tryShowPrompter() {
    const map = PROMPTER_MAP[currentScript];
    if (!map) return;
    const text = map[currentIndex];
    if (text) showPrompter(text);
  }

  /* ================================================================
     Script 1 動畫
     ================================================================ */

  const s1 = {
    page3AudioIds: [
      's1-sfx-voice-page3-first',
      's1-sfx-voice-page3-second',
      's1-sfx-voice-page3-third',
    ],

    resetSlide2() {
      const page = document.getElementById('s1-pill-page-2');
      if (!page) return;
      const aiIcon = page.querySelector('.ai-icon');
      const chatText = page.querySelector('.chat-text');
      const micIcon = page.querySelector('.mic-icon');
      [aiIcon, chatText, micIcon].forEach(el => {
        if (el) { el.classList.remove('animate-in'); el.classList.remove('animate-out'); }
      });
      if (chatText) {
        chatText.style.removeProperty('--reveal-duration');
        chatText.style.removeProperty('--fadeout-duration');
      }
      if (micIcon) { micIcon.style.transition = ''; micIcon.style.opacity = ''; }
      stopGlow();
      stopAudio('sfx-icon-appear');
      stopAudio('s1-sfx-voice-greeting');
      isAnimating = false;
    },

    animateSlide2() {
      const page = document.getElementById('s1-pill-page-2');
      if (!page) return;
      const aiIcon = page.querySelector('.ai-icon');
      const chatText = page.querySelector('.chat-text');
      const micIcon = page.querySelector('.mic-icon');
      const sfxVoiceEl = document.getElementById('s1-sfx-voice-greeting');

      isAnimating = true;

      if (aiIcon) aiIcon.classList.add('animate-in');
      playAudio('sfx-icon-appear');

      setAnimTimeout(() => {
        if (micIcon) micIcon.classList.add('animate-in');
        const voicePlaying = playAudio('s1-sfx-voice-greeting');

        if (voicePlaying && sfxVoiceEl && sfxVoiceEl.duration && isFinite(sfxVoiceEl.duration)) {
          if (chatText) {
            chatText.style.setProperty('--reveal-duration', sfxVoiceEl.duration + 's');
            chatText.classList.add('animate-in');
          }
          startGlowWithAudio(sfxVoiceEl);
          sfxVoiceEl.onended = () => { stopGlow(); isAnimating = false; tryShowPrompter(); };
          sfxVoiceEl.onpause = () => { stopGlow(); isAnimating = false; };
        } else {
          if (chatText) chatText.classList.add('animate-in');
          const pg = getPillGlow();
          if (pg) pg.classList.add('active');
          setAnimTimeout(() => { stopGlow(); isAnimating = false; tryShowPrompter(); }, 2000);
        }
      }, 600);
    },

    resetSlide3() {
      const page3 = document.getElementById('s1-pill-page-3');
      if (page3) {
        page3.querySelectorAll('.mini-pill').forEach(el => el.classList.remove('pop-in'));
      }
      const page2 = document.getElementById('s1-pill-page-2');
      if (page2) {
        const chatText = page2.querySelector('.chat-text');
        if (chatText) {
          chatText.classList.remove('animate-out');
          chatText.style.removeProperty('--fadeout-duration');
          chatText.style.removeProperty('opacity');
          chatText.style.removeProperty('clip-path');
        }
        const micIcon2 = page2.querySelector('.mic-icon');
        if (micIcon2) { micIcon2.style.transition = ''; micIcon2.style.opacity = ''; }
      }
      stopGlow();
      stopAudio('sfx-notification-bell');
      stopAudio('s1-sfx-voice-transition-p2p3');
      s1.page3AudioIds.forEach(id => stopAudio(id));
      stopAudio('s1-sfx-voice-page3-closing');
      isAnimating = false;
    },

    animateSlide3() {
      const page2 = document.getElementById('s1-pill-page-2');
      const page3 = document.getElementById('s1-pill-page-3');
      if (!page3) return;
      const chatText = page2 ? page2.querySelector('.chat-text') : null;
      const micIcon2 = page2 ? page2.querySelector('.mic-icon') : null;
      const transitionAudioEl = document.getElementById('s1-sfx-voice-transition-p2p3');

      isAnimating = true;

      if (page2) page2.classList.add('active');
      if (page3) page3.classList.remove('active');

      // 步驟 1：鈴聲 + 光效
      playAudio('sfx-notification-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 步驟 2：800ms 後播放語音
      setAnimTimeout(() => {
        const transitionPlaying = playAudio('s1-sfx-voice-transition-p2p3');

        if (transitionPlaying && transitionAudioEl) {
          startGlowWithAudio(transitionAudioEl);

          const startTextFadeout = () => {
            const dur = transitionAudioEl.duration;
            if (chatText) {
              const fadeDur = (dur && isFinite(dur)) ? Math.min(dur, 0.5) : 0.5;
              chatText.style.setProperty('--fadeout-duration', fadeDur + 's');
              chatText.style.opacity = '1';
              chatText.style.clipPath = 'inset(0 0 0 0)';
              chatText.classList.remove('animate-in');
              chatText.classList.add('animate-out');
            }
          };

          if (transitionAudioEl.duration && isFinite(transitionAudioEl.duration)) {
            startTextFadeout();
          } else {
            transitionAudioEl.addEventListener('loadedmetadata', startTextFadeout, { once: true });
            setAnimTimeout(() => { if (chatText && !chatText.classList.contains('animate-out')) startTextFadeout(); }, 300);
          }

          transitionAudioEl.onended = () => {
            stopGlow();
            if (micIcon2) { micIcon2.style.transition = 'opacity 0.3s ease-out'; micIcon2.style.opacity = '0'; }
            setAnimTimeout(() => { s1.startPhase2(page2, page3); }, 400);
          };
          transitionAudioEl.onpause = () => { stopGlow(); };
        } else {
          if (chatText) {
            chatText.style.opacity = '1'; chatText.style.clipPath = 'inset(0 0 0 0)';
            chatText.classList.remove('animate-in'); chatText.classList.add('animate-out');
          }
          setAnimTimeout(() => {
            stopGlow();
            if (micIcon2) { micIcon2.style.transition = 'opacity 0.3s ease-out'; micIcon2.style.opacity = '0'; }
            setAnimTimeout(() => { s1.startPhase2(page2, page3); }, 400);
          }, 1500);
        }
      }, 800);
    },

    startPhase2(page2, page3) {
      if (page2) page2.classList.remove('active');
      if (page3) page3.classList.add('active');
      const miniPills = page3.querySelectorAll('.mini-pill');
      s1.playPillSequence(miniPills, 0);
    },

    playPillSequence(pills, index) {
      if (index >= pills.length) {
        const closingEl = document.getElementById('s1-sfx-voice-page3-closing');
        // closing 語音播完後等 3000ms → 自動進入 page 4（鈴聲 + 問句）
        const afterClosing = () => {
          stopGlow();
          setAnimTimeout(() => {
            showSlide(3); // 自動切到 slide 4，觸發 animateSlide4
          }, 3000);
        };
        if (closingEl) {
          const closingPlayed = playAudio('s1-sfx-voice-page3-closing');
          if (closingPlayed) {
            startGlowWithAudio(closingEl);
            closingEl.onended = () => { afterClosing(); };
            closingEl.onpause = () => { stopGlow(); isAnimating = false; };
          } else { afterClosing(); }
        } else { afterClosing(); }
        return;
      }
      const pill = pills[index];
      const audioId = s1.page3AudioIds[index];
      const audioEl = document.getElementById(audioId);
      pill.classList.add('pop-in');
      playBloop();
      setAnimTimeout(() => {
        if (audioEl) {
          const played = playAudio(audioId);
          if (played) {
            startGlowWithAudio(audioEl);
            audioEl.onended = () => { stopGlow(); setAnimTimeout(() => { s1.playPillSequence(pills, index + 1); }, 400); };
            audioEl.onpause = () => { stopGlow(); };
          } else { setAnimTimeout(() => { s1.playPillSequence(pills, index + 1); }, 1500); }
        } else { setAnimTimeout(() => { s1.playPillSequence(pills, index + 1); }, 1500); }
      }, 300);
    },

    resetSlide4() {
      const page4 = document.getElementById('s1-pill-page-4');
      if (!page4) return;
      page4.querySelectorAll('.mini-pill').forEach(el => el.classList.remove('slide-out'));
      const aiIcon = page4.querySelector('.ai-icon-p4');
      if (aiIcon) aiIcon.classList.remove('exit');
      const logo = page4.querySelector('.logo-img-p4');
      if (logo) logo.classList.remove('fade-in');
      const wrapper = page4.querySelector('.mini-pills-wrapper');
      if (wrapper) wrapper.style.display = '';
      const aiWrapper = page4.querySelector('.ai-icon-wrapper');
      if (aiWrapper) aiWrapper.style.display = '';
      stopGlow();
      stopAudio('sfx-notification-bell');
      stopAudio('s1-sfx-voice-page4');
      isAnimating = false;
    },

    animateSlide4() {
      const page4 = document.getElementById('s1-pill-page-4');
      if (!page4) return;
      const miniPills = page4.querySelectorAll('.mini-pill');
      const aiIcon = page4.querySelector('.ai-icon-p4');
      const logo = page4.querySelector('.logo-img-p4');
      const sfxVoiceEl = document.getElementById('s1-sfx-voice-page4');

      isAnimating = true;

      // 步驟 1：鈴聲 + 光效
      playAudio('sfx-notification-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 步驟 2：800ms 後播放語音
      setAnimTimeout(() => {
        const voicePlaying = playAudio('s1-sfx-voice-page4');

        if (voicePlaying && sfxVoiceEl) {
          startGlowWithAudio(sfxVoiceEl);
          const startPillExit = () => {
            const duration = sfxVoiceEl.duration;
            const pillDelay = (duration && isFinite(duration))
              ? Math.min((duration * 1000 * 0.5) / miniPills.length, 300) : 200;
            miniPills.forEach((pill, i) => { setAnimTimeout(() => { pill.classList.add('slide-out'); }, pillDelay * i); });
          };
          if (sfxVoiceEl.duration && isFinite(sfxVoiceEl.duration)) { startPillExit(); }
          else {
            sfxVoiceEl.addEventListener('loadedmetadata', startPillExit, { once: true });
            setAnimTimeout(() => { if (!miniPills[0].classList.contains('slide-out')) startPillExit(); }, 300);
          }
          sfxVoiceEl.onended = () => { stopGlow(); s1.startPage4IconExit(aiIcon, logo, page4); };
          sfxVoiceEl.onpause = () => { stopGlow(); };
        } else {
          const pillDelay = 200;
          miniPills.forEach((pill, i) => { setAnimTimeout(() => { pill.classList.add('slide-out'); }, pillDelay * i); });
          setAnimTimeout(() => { stopGlow(); s1.startPage4IconExit(aiIcon, logo, page4); }, pillDelay * miniPills.length + 400);
        }
      }, 800);
    },

    startPage4IconExit(aiIcon, logo, page4) {
      const wrapper = page4.querySelector('.mini-pills-wrapper');
      if (wrapper) wrapper.style.display = 'none';
      if (aiIcon) aiIcon.classList.add('exit');
      setAnimTimeout(() => {
        const aiWrapper = page4.querySelector('.ai-icon-wrapper');
        if (aiWrapper) aiWrapper.style.display = 'none';
        if (logo) logo.classList.add('fade-in');
        setAnimTimeout(() => { isAnimating = false; }, 600);
      }, 650);
    },

    animations: {
      1: () => s1.animateSlide2(),
      2: () => s1.animateSlide3(),
      3: () => s1.animateSlide4(),
    },

    resets: {
      1: () => s1.resetSlide2(),
      2: () => s1.resetSlide3(),
      3: () => s1.resetSlide4(),
    },

    specialTransitions: {
      '1->2': true,  // 第二頁→第三頁
      '2->3': true,  // 第三頁→第四頁
    },

    skipPillPageSwitch: {
      '1->2': true,  // animateSlide3 自行控制 pill-page 切換
    },
  };

  /* ================================================================
     Script 2 動畫
     只有兩頁：第一頁 COMPAL + 第二頁所有內容
     第二頁動畫序列：
       AI icon 進場 → 第一行文字 → 第一行消失 + 第二行文字 →
       第二行消失 + Gmail icon 淡入 + 音效 → 4 小膠囊依序滑入
     ================================================================ */

  const s2 = {
    /* ---------------------------------------------------------------
       共用工具：重置文字行
       --------------------------------------------------------------- */
    resetTextLines(lineIds) {
      lineIds.forEach(id => {
        const line = document.getElementById(id);
        if (!line) return;
        line.classList.remove('active');
        const ct = line.querySelector('.chat-text');
        if (ct) {
          ct.classList.remove('animate-in', 'animate-out');
          ct.style.removeProperty('--reveal-duration');
          ct.style.removeProperty('--fadeout-duration');
          ct.style.removeProperty('opacity');
          ct.style.removeProperty('clip-path');
        }
      });
    },

    /* ---------------------------------------------------------------
       第二頁：重置
       --------------------------------------------------------------- */
    resetSlide2() {
      const page = document.getElementById('s2-pill-page-2');
      if (!page) return;

      const aiIcon = page.querySelector('.ai-icon');
      if (aiIcon) aiIcon.classList.remove('animate-in');

      s2.resetTextLines(['s2-text-line1', 's2-text-line2']);

      const pillsWrap = document.getElementById('s2-mini-pills');
      if (pillsWrap) {
        pillsWrap.classList.remove('active');
        pillsWrap.querySelectorAll('.mini-pill').forEach(el => el.classList.remove('pop-in'));
      }

      const gmailCircle = document.getElementById('s2-gmail-circle');
      if (gmailCircle) gmailCircle.classList.remove('animate-in');

      stopGlow();
      stopAudio('sfx-icon-appear');
      stopAudio('s2-sfx-voice-greeting-1');
      stopAudio('s2-sfx-voice-greeting-2');
      stopAudio('s2-sfx-voice-details-q');
      stopAudio('sfx-gmail-notify');
      isAnimating = false;
    },

    /* ---------------------------------------------------------------
       第二頁：動畫
       AI icon → 語音(兩行文字) → 文字消失 → 小膠囊 → Gmail → 問句語音+光效
       --------------------------------------------------------------- */
    animateSlide2() {
      const page = document.getElementById('s2-pill-page-2');
      if (!page) return;

      const aiIcon = page.querySelector('.ai-icon');
      const line1 = document.getElementById('s2-text-line1');
      const line2 = document.getElementById('s2-text-line2');
      const chatText1 = line1 ? line1.querySelector('.chat-text') : null;
      const chatText2 = line2 ? line2.querySelector('.chat-text') : null;
      const gmailCircle = document.getElementById('s2-gmail-circle');
      const pillsWrap = document.getElementById('s2-mini-pills');
      const voiceEl1 = document.getElementById('s2-sfx-voice-greeting-1');
      const voiceEl2 = document.getElementById('s2-sfx-voice-greeting-2');

      isAnimating = true;

      // 步驟 1：AI icon 進場 + 音效
      if (aiIcon) aiIcon.classList.add('animate-in');
      playAudio('sfx-icon-appear');

      // 安全取得 duration 的輔助函式
      const getDur = (el) => (el && el.duration && isFinite(el.duration)) ? el.duration : 3.0;

      // 步驟 2：600ms 後播放第一段語音 + 第一行文字
      setAnimTimeout(() => {
        if (line1) line1.classList.add('active');
        const voice1Playing = playAudio('s2-sfx-voice-greeting-1');

        if (voice1Playing && voiceEl1) {
          startGlowWithAudio(voiceEl1);

          // 第一行揭露動畫：時長 = 第一段語音長度
          if (chatText1) {
            const dur1 = getDur(voiceEl1);
            chatText1.style.setProperty('--reveal-duration', dur1 + 's');
            chatText1.classList.add('animate-in');
          }

          // 第一段結束 → 停頓 200ms → 淡出第一行 → 顯示第二行 + 播放第二段
          voiceEl1.onended = () => {
            stopGlow();
            setAnimTimeout(() => {
              // 第一行淡出
              if (chatText1) {
                chatText1.style.opacity = '1';
                chatText1.style.clipPath = 'inset(0 0 0 0)';
                chatText1.classList.remove('animate-in');
                chatText1.style.setProperty('--fadeout-duration', '0.3s');
                chatText1.classList.add('animate-out');
              }
              // 350ms 後切換行 + 播放第二段
              setAnimTimeout(() => {
                if (line1) line1.classList.remove('active');
                if (line2) line2.classList.add('active');

                const voice2Playing = playAudio('s2-sfx-voice-greeting-2');
                if (voice2Playing && voiceEl2) {
                  startGlowWithAudio(voiceEl2);
                  const dur2 = getDur(voiceEl2);
                  if (chatText2) {
                    chatText2.style.setProperty('--reveal-duration', dur2 + 's');
                    chatText2.classList.add('animate-in');
                  }
                  voiceEl2.onended = () => {
                    stopGlow();
                    s2.afterGreetingEnded(chatText2, line2, gmailCircle, pillsWrap, 's2-sfx-voice-details-q');
                  };
                  voiceEl2.onpause = () => { stopGlow(); };
                } else {
                  // 第二段無法播放 → 備用計時器
                  if (chatText2) chatText2.classList.add('animate-in');
                  setAnimTimeout(() => {
                    stopGlow();
                    s2.afterGreetingEnded(chatText2, line2, gmailCircle, pillsWrap, 's2-sfx-voice-details-q');
                  }, getDur(voiceEl2) * 1000);
                }
              }, 350);
            }, 200);
          };
          voiceEl1.onpause = () => { stopGlow(); };

        } else {
          // 無語音備用
          if (chatText1) chatText1.classList.add('animate-in');
          if (line1) line1.classList.add('active');
          const pg = getPillGlow();
          if (pg) pg.classList.add('active');
          setAnimTimeout(() => {
            stopGlow();
            s2.afterGreetingEnded(chatText1, line1, gmailCircle, pillsWrap, 's2-sfx-voice-details-q');
          }, 3000);
        }
      }, 600);
    },

    /* ---------------------------------------------------------------
       第三頁：重置
       --------------------------------------------------------------- */
    resetSlide3() {
      const page = document.getElementById('s2-pill-page-3');
      if (!page) return;

      s2.resetTextLines(['s2-p3-text-line1', 's2-p3-text-line2']);

      const pillsWrap = document.getElementById('s2-p3-mini-pills');
      if (pillsWrap) {
        pillsWrap.classList.remove('active');
        pillsWrap.querySelectorAll('.mini-pill').forEach(el => el.classList.remove('pop-in'));
      }

      const calCircle = document.getElementById('s2-calendar-circle');
      if (calCircle) calCircle.classList.remove('animate-in');

      stopGlow();
      stopAudio('s2-sfx-voice-page3-1');
      stopAudio('s2-sfx-voice-page3-2');
      stopAudio('s2-sfx-voice-calendar-q');
      stopAudio('sfx-gmail-notify');
      isAnimating = false;
    },

    /* ---------------------------------------------------------------
       第三頁：動畫
       語音(兩行文字) → 文字消失 → 3 小膠囊 → 行事曆 icon → 問句語音+光效
       --------------------------------------------------------------- */
    animateSlide3() {
      const page = document.getElementById('s2-pill-page-3');
      if (!page) return;

      const line1 = document.getElementById('s2-p3-text-line1');
      const line2 = document.getElementById('s2-p3-text-line2');
      const chatText1 = line1 ? line1.querySelector('.chat-text') : null;
      const chatText2 = line2 ? line2.querySelector('.chat-text') : null;
      const calCircle = document.getElementById('s2-calendar-circle');
      const pillsWrap = document.getElementById('s2-p3-mini-pills');
      const voiceEl1 = document.getElementById('s2-sfx-voice-page3-1');
      const voiceEl2 = document.getElementById('s2-sfx-voice-page3-2');

      isAnimating = true;

      // 步驟 1：鈴聲 + 光效
      playAudio('s2-sfx-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 安全取得 duration 的輔助函式
      const getDur = (el) => (el && el.duration && isFinite(el.duration)) ? el.duration : 3.0;

      // 步驟 2：800ms 後播放第一段語音 + 第一行文字
      setAnimTimeout(() => {
        if (line1) line1.classList.add('active');
        const voice1Playing = playAudio('s2-sfx-voice-page3-1');

        if (voice1Playing && voiceEl1) {
          startGlowWithAudio(voiceEl1);

          // 第一行揭露動畫：時長 = 第一段語音長度
          if (chatText1) {
            const dur1 = getDur(voiceEl1);
            chatText1.style.setProperty('--reveal-duration', dur1 + 's');
            chatText1.classList.add('animate-in');
          }

          // 第一段結束 → 停頓 200ms → 淡出第一行 → 顯示第二行 + 播放第二段
          voiceEl1.onended = () => {
            stopGlow();
            setAnimTimeout(() => {
              // 第一行淡出
              if (chatText1) {
                chatText1.style.opacity = '1';
                chatText1.style.clipPath = 'inset(0 0 0 0)';
                chatText1.classList.remove('animate-in');
                chatText1.style.setProperty('--fadeout-duration', '0.3s');
                chatText1.classList.add('animate-out');
              }
              // 350ms 後切換行 + 播放第二段
              setAnimTimeout(() => {
                if (line1) line1.classList.remove('active');
                if (line2) line2.classList.add('active');

                const voice2Playing = playAudio('s2-sfx-voice-page3-2');
                if (voice2Playing && voiceEl2) {
                  startGlowWithAudio(voiceEl2);
                  const dur2 = getDur(voiceEl2);
                  if (chatText2) {
                    chatText2.style.setProperty('--reveal-duration', dur2 + 's');
                    chatText2.classList.add('animate-in');
                  }
                  voiceEl2.onended = () => {
                    stopGlow();
                    s2.afterGreetingEnded(chatText2, line2, calCircle, pillsWrap, 's2-sfx-voice-calendar-q');
                  };
                  voiceEl2.onpause = () => { stopGlow(); };
                } else {
                  // 第二段無法播放 → 備用計時器
                  if (chatText2) chatText2.classList.add('animate-in');
                  setAnimTimeout(() => {
                    stopGlow();
                    s2.afterGreetingEnded(chatText2, line2, calCircle, pillsWrap, 's2-sfx-voice-calendar-q');
                  }, getDur(voiceEl2) * 1000);
                }
              }, 350);
            }, 200);
          };
          voiceEl1.onpause = () => { stopGlow(); };

        } else {
          // 無語音備用
          if (chatText1) chatText1.classList.add('animate-in');
          setAnimTimeout(() => {
            stopGlow();
            s2.afterGreetingEnded(chatText1, line1, calCircle, pillsWrap, 's2-sfx-voice-calendar-q');
          }, 3000);
        }
      }, 800);
    },

    /* ---------------------------------------------------------------
       共用：主語音結束後的動畫序列
       文字消失 → 小膠囊 pop-in → icon 圓底淡入+音效 → 問句語音+光效
       --------------------------------------------------------------- */
    afterGreetingEnded(chatText, textLine, iconCircle, pillsWrap, questionAudioId) {
      // 語音結束後讓文字多停留一會兒再消失
      setAnimTimeout(() => {
        if (chatText) {
          chatText.style.opacity = '1';
          chatText.style.clipPath = 'inset(0 0 0 0)';
          chatText.classList.remove('animate-in');
          chatText.style.setProperty('--fadeout-duration', '0.3s');
          chatText.classList.add('animate-out');
        }
      }, 800);

      setAnimTimeout(() => {
        if (textLine) textLine.classList.remove('active');

        // 顯示容器
        if (pillsWrap) pillsWrap.classList.add('active');

        // 小膠囊依序 pop-in
        const miniPills = pillsWrap ? pillsWrap.querySelectorAll('.mini-pill') : [];
        miniPills.forEach((pill, i) => {
          setAnimTimeout(() => {
            pill.classList.add('pop-in');
            playBloop();
          }, 400 * i);
        });

        // icon 圓底淡入 + 音效
        const iconDelay = 400 * miniPills.length + 300;
        setAnimTimeout(() => {
          if (iconCircle) iconCircle.classList.add('animate-in');
          playAudio('sfx-gmail-notify');

          // icon 淡入後 → 問句語音 + 光效
          setAnimTimeout(() => {
            s2.playQuestion(questionAudioId);
          }, 600);
        }, iconDelay);
      }, 1200);
    },

    /* ---------------------------------------------------------------
       共用：播放問句語音 + 光效，結束後解鎖
       --------------------------------------------------------------- */
    playQuestion(audioId) {
      const qEl = document.getElementById(audioId);
      const voicePlaying = playAudio(audioId);

      if (voicePlaying && qEl) {
        startGlowWithAudio(qEl);
        qEl.onended = () => {
          stopGlow();
          isAnimating = false;
          tryShowPrompter();
        };
        qEl.onpause = () => { stopGlow(); };
      } else {
        // 無音檔：光效閃一下即結束
        const pg = getPillGlow();
        if (pg) pg.classList.add('active');
        setAnimTimeout(() => {
          stopGlow();
          isAnimating = false;
          tryShowPrompter();
        }, 2000);
      }
    },

    /* ---------------------------------------------------------------
       第四頁：重置
       --------------------------------------------------------------- */
    resetSlide4() {
      const textLine = document.getElementById('s2-p4-text-line1');
      if (textLine) {
        const ct = textLine.querySelector('.chat-text');
        if (ct) {
          ct.classList.remove('animate-in', 'animate-out');
          ct.style.removeProperty('--reveal-duration');
          ct.style.removeProperty('opacity');
          ct.style.removeProperty('clip-path');
        }
      }

      // 行事曆恢復可見（初始狀態）
      const cal = document.getElementById('s2-p4-calendar');
      if (cal) { cal.classList.remove('animate-in'); cal.style.opacity = '1'; }

      // 打勾恢復隱藏
      const check = document.getElementById('s2-p4-checkmark');
      if (check) { check.classList.remove('animate-in'); check.style.opacity = '0'; }

      stopGlow();
      stopAudio('s2-sfx-bell');
      stopAudio('s2-sfx-voice-page4');
      stopAudio('s2-sfx-checkmark');
      stopAudio('s2-sfx-voice-anything-else');
      isAnimating = false;
    },

    /* ---------------------------------------------------------------
       第四頁：動畫
       鈴聲+光效 → 語音+文字+光效 → 文字保留+行事曆icon淡入
       → 行事曆被打勾取代+音效 → 音效結束後問句語音+光效
       --------------------------------------------------------------- */
    animateSlide4() {
      const page = document.getElementById('s2-pill-page-4');
      if (!page) return;

      const textLine = document.getElementById('s2-p4-text-line1');
      const chatText = textLine ? textLine.querySelector('.chat-text') : null;
      const calCircle = document.getElementById('s2-p4-calendar');
      const checkCircle = document.getElementById('s2-p4-checkmark');
      const sfxVoiceEl = document.getElementById('s2-sfx-voice-page4');

      isAnimating = true;

      // 步驟 1：鈴聲 + 光效
      playAudio('s2-sfx-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 步驟 2：800ms 後 → 語音開始 + 文字揭露 + 光效隨語音
      setAnimTimeout(() => {
        const voicePlaying = playAudio('s2-sfx-voice-page4');

        if (voicePlaying && sfxVoiceEl) {
          startGlowWithAudio(sfxVoiceEl);

          const runWithDuration = () => {
            const dur = sfxVoiceEl.duration;
            if (chatText) {
              chatText.style.setProperty('--reveal-duration', dur + 's');
              chatText.classList.add('animate-in');
            }
          };

          if (sfxVoiceEl.duration && isFinite(sfxVoiceEl.duration)) {
            runWithDuration();
          } else {
            sfxVoiceEl.addEventListener('loadedmetadata', runWithDuration, { once: true });
            setAnimTimeout(() => {
              if (chatText && !chatText.classList.contains('animate-in')) {
                chatText.classList.add('animate-in');
              }
            }, 500);
          }

          // 語音結束 → 文字保留 + 行事曆出現
          sfxVoiceEl.onended = () => {
            stopGlow();
            s2.afterPage4VoiceEnded(calCircle, checkCircle);
          };
          sfxVoiceEl.onpause = () => { stopGlow(); };

        } else {
          // 無語音備用
          if (chatText) chatText.classList.add('animate-in');
          setAnimTimeout(() => {
            stopGlow();
            s2.afterPage4VoiceEnded(calCircle, checkCircle);
          }, 3000);
        }
      }, 800);
    },

    /* ---------------------------------------------------------------
       第四頁：語音結束後
       行事曆已在 → 被打勾取代+音效 → 打勾動畫重播兩次(共3次) → 問句語音+光效
       --------------------------------------------------------------- */
    afterPage4VoiceEnded(calCircle, checkCircle) {
      // 行事曆淡出 + 打勾淡入 + 音效
      if (calCircle) calCircle.style.opacity = '0';
      if (checkCircle) checkCircle.classList.add('animate-in');
      playAudio('s2-sfx-checkmark');

      // 強制重載 SVG 以觸發打勾動畫（cache-busting）
      const triggerCheckAnim = () => {
        const svgImg = checkCircle ? checkCircle.querySelector('.checkmark-icon') : null;
        if (svgImg) {
          svgImg.src = 'images/checkmark-anim.svg?t=' + Date.now();
        }
      };
      triggerCheckAnim();

      // 打勾 SVG 動畫重播函式
      const replayCheckmark = (cb) => {
        triggerCheckAnim();
        // 等動畫完成（勾 0.1s delay + 0.5s = ~0.7s，留餘量 1s）
        setAnimTimeout(() => { if (cb) cb(); }, 1000);
      };

      // 第一次動畫完成後重播第二次
      setAnimTimeout(() => {
        replayCheckmark(() => {
          // 第二次完成後重播第三次
          replayCheckmark(() => {
            // 全部完成 → 鈴聲 + 光效 → 800ms 後問句語音
            playAudio('s2-sfx-bell');
            const pg = getPillGlow();
            if (pg) pg.classList.add('active');
            setAnimTimeout(() => {
              s2.playQuestion('s2-sfx-voice-anything-else');
            }, 800);
          });
        });
      }, 1000);
    },

    /* ---------------------------------------------------------------
       第五頁：重置
       --------------------------------------------------------------- */
    resetSlide5() {
      const page = document.getElementById('s2-pill-page-5');
      if (!page) return;

      // 文字恢復可見
      const textEl = page.querySelector('.s2-p5-text');
      if (textEl) textEl.classList.remove('wipe-out');

      // 打勾恢復可見
      const checkEl = page.querySelector('.s2-p5-checkmark');
      if (checkEl) checkEl.classList.remove('fade-out');

      // AI icon 恢復
      const aiIcon = page.querySelector('.ai-icon-p4');
      if (aiIcon) {
        aiIcon.classList.remove('exit');
        aiIcon.style.removeProperty('opacity');
        aiIcon.style.removeProperty('transform');
      }
      const aiWrapper = page.querySelector('.ai-icon-wrapper');
      if (aiWrapper) aiWrapper.style.removeProperty('display');

      // COMPAL logo 隱藏
      const logo = page.querySelector('.logo-img-p4');
      if (logo) {
        logo.classList.remove('fade-in');
        logo.style.removeProperty('opacity');
      }

      stopGlow();
      stopAudio('s2-sfx-bell');
      stopAudio('s2-sfx-voice-page5');
      isAnimating = false;
    },

    /* ---------------------------------------------------------------
       第五頁：動畫
       文字由左到右消失 + 打勾淡出 → 同時鈴聲+語音+光效
       → AI icon 旋轉縮小離場（同 S1）→ 語音結束後 COMPAL 淡入
       --------------------------------------------------------------- */
    animateSlide5() {
      const page = document.getElementById('s2-pill-page-5');
      if (!page) return;

      const textEl = page.querySelector('.s2-p5-text');
      const checkEl = page.querySelector('.s2-p5-checkmark');
      const aiIcon = page.querySelector('.ai-icon-p4');
      const aiWrapper = page.querySelector('.ai-icon-wrapper');
      const logo = page.querySelector('.logo-img-p4');
      const sfxVoiceEl = document.getElementById('s2-sfx-voice-page5');

      isAnimating = true;

      // 文字由左到右消失 + 打勾淡出
      if (textEl) textEl.classList.add('wipe-out');
      if (checkEl) checkEl.classList.add('fade-out');

      // 步驟 1：鈴聲 + 光效
      playAudio('s2-sfx-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 步驟 2：800ms 後播放語音
      setAnimTimeout(() => {
        const voicePlaying = playAudio('s2-sfx-voice-page5');

        if (voicePlaying && sfxVoiceEl) {
          startGlowWithAudio(sfxVoiceEl);
          sfxVoiceEl.onended = () => {
            stopGlow();
            // 語音結束 → AI icon 旋轉縮小離場
            if (aiIcon) aiIcon.classList.add('exit');
            setAnimTimeout(() => {
              if (aiWrapper) aiWrapper.style.display = 'none';
              if (logo) logo.classList.add('fade-in');
              setAnimTimeout(() => { isAnimating = false; }, 600);
            }, 650);
          };
          sfxVoiceEl.onpause = () => { stopGlow(); };
        } else {
          setAnimTimeout(() => {
            stopGlow();
            if (aiIcon) aiIcon.classList.add('exit');
            setAnimTimeout(() => {
              if (aiWrapper) aiWrapper.style.display = 'none';
              if (logo) logo.classList.add('fade-in');
              setAnimTimeout(() => { isAnimating = false; }, 600);
            }, 650);
          }, 2000);
        }
      }, 800);
    },

    animations: {
      1: () => s2.animateSlide2(),
      2: () => s2.animateSlide3(),
      3: () => s2.animateSlide4(),
      4: () => s2.animateSlide5(),
    },

    resets: {
      1: () => s2.resetSlide2(),
      2: () => s2.resetSlide3(),
      3: () => s2.resetSlide4(),
      4: () => s2.resetSlide5(),
    },

    specialTransitions: {},
    skipPillPageSwitch: {},
  };

  /* ================================================================
     Script 3
     ================================================================ */

  const s3 = {
    /* ---------------------------------------------------------------
       第二頁：重置
       --------------------------------------------------------------- */
    resetSlide2() {
      const page = document.getElementById('s3-pill-page-2');
      if (!page) return;

      // AI icon
      const aiIcon = page.querySelector('.ai-icon');
      if (aiIcon) {
        aiIcon.classList.remove('animate-in');
        aiIcon.style.removeProperty('opacity');
      }

      // 所有 group 重置
      page.querySelectorAll('.s3-group').forEach(g => {
        g.classList.remove('active', 'fade-in', 'fade-out', 'slide-out-right');
        g.style.removeProperty('opacity');
        g.style.removeProperty('transform');
      });

      // Group A 元素重置
      const tomPill = document.getElementById('s3-tom-pill');
      if (tomPill) tomPill.classList.remove('pop-in');
      const febPill = document.getElementById('s3-feb-pill');
      if (febPill) febPill.classList.remove('slide-in');
      const trackText = document.getElementById('s3-tracking-text');
      if (trackText) trackText.classList.remove('reveal');

      // Group B 元素重置
      const janPill = document.getElementById('s3-jan-pill');
      if (janPill) janPill.classList.remove('pop-in');
      const capsule = document.getElementById('s3-gray-capsule');
      if (capsule) {
        capsule.classList.remove('show', 'fade-bg');
        const calIcon = capsule.querySelector('.s3-capsule-calendar-icon');
        if (calIcon) calIcon.style.removeProperty('opacity');
      }
      const bar = document.getElementById('s3-proposal-bar');
      if (bar) {
        bar.classList.remove('grow', 'shrink-to-circle');
        bar.style.removeProperty('max-width');
        bar.style.removeProperty('opacity');
        bar.style.removeProperty('padding');
        bar.style.removeProperty('transform');
        bar.style.removeProperty('transition');
        bar.style.removeProperty('clip-path');
      }
      const barText = page.querySelector('.s3-proposal-text');
      if (barText) barText.classList.remove('show', 'fade-out');
      const num18 = document.getElementById('s3-number-18');
      if (num18) {
        num18.classList.remove('show');
        num18.style.removeProperty('position');
        num18.style.removeProperty('right');
        num18.style.removeProperty('top');
        num18.style.removeProperty('width');
        num18.style.removeProperty('height');
        num18.style.removeProperty('display');
        num18.style.removeProperty('align-items');
        num18.style.removeProperty('justify-content');
      }

      // Group C 依序出現的 pill 重置
      page.querySelectorAll('.s3-seq-pill').forEach(el => {
        el.classList.remove('pop-in');
      });

      // s3-circle-18 重置
      const circle18 = document.getElementById('s3-circle-18');
      if (circle18) circle18.classList.remove('pop-in');

      stopGlow();
      stopAudio('s3-sfx-voice-part1');
      stopAudio('s3-sfx-voice-part2');
      stopAudio('s3-sfx-voice-part3');
      stopAudio('s3-sfx-voice-anything-else');
      stopAudio('s3-sfx-bell');
      stopAudio('s3-sfx-voice-part4');

      // 如果正在 page3，也一併重置
      s3.resetSlide3();
      isAnimating = false;
    },

    /* ---------------------------------------------------------------
       第二頁：主動畫入口
       序列：AI icon 出場 → 語音1 → GroupA 動畫
             → GroupA 淡出 → 語音2 → GroupB 動畫
             → 灰色膠囊淡出 → 語音3 → GroupC 出現
             → 最後語音
       --------------------------------------------------------------- */
    animateSlide2() {
      const page = document.getElementById('s3-pill-page-2');
      if (!page) return;
      isAnimating = true;

      // AI icon 出場 + 音效
      const aiIcon = page.querySelector('.ai-icon');
      if (aiIcon) aiIcon.classList.add('animate-in');
      playAudio('sfx-icon-appear');

      // 600ms 後播放第一段語音
      setAnimTimeout(() => { s3.playVoice1(); }, 600);
    },

    /* ---------------------------------------------------------------
       第一段語音：Sure, based on Tom's mail...on February 8th.
       → Tom pill 彈入 → 文字出現 → 8 Feb pill 出現
       --------------------------------------------------------------- */
    playVoice1() {
      const voice1El = document.getElementById('s3-sfx-voice-part1');
      const played = playAudio('s3-sfx-voice-part1');
      let ended = false;

      const onEnd = () => {
        if (ended) return;
        ended = true;
        stopGlow();
        // 語音1 結束 → 等 500ms 後淡出 Group A → 進入第二段
        setAnimTimeout(() => { s3.fadeOutGroupA(); }, 500);
      };

      if (played && voice1El) {
        startGlowWithAudio(voice1El);
        voice1El.onended = onEnd;
        voice1El.onpause = () => { stopGlow(); };
      }

      // 語音開始 300ms：顯示 Group A 容器
      setAnimTimeout(() => {
        const groupA = document.getElementById('s3-group-a');
        if (groupA) { groupA.classList.add('active', 'fade-in'); }
      }, 300);

      // 語音說到 "Tom" (~1.5s)：Tom pill 彈入
      setAnimTimeout(() => {
        const tomPill = document.getElementById('s3-tom-pill');
        if (tomPill) tomPill.classList.add('pop-in');
        playBloop();
      }, 1500);

      // Tom pill 出現後 500ms：tracking 文字由左到右出現
      setAnimTimeout(() => {
        const trackText = document.getElementById('s3-tracking-text');
        if (trackText) trackText.classList.add('reveal');
      }, 2000);

      // 語音說到 "February" (~4.5s)：8 Feb pill 滑入
      setAnimTimeout(() => {
        const febPill = document.getElementById('s3-feb-pill');
        if (febPill) febPill.classList.add('slide-in');
        playBloop();
      }, 4500);

      // 安全 fallback（6 秒）
      setAnimTimeout(() => { onEnd(); }, 6000);
    },

    /* ---------------------------------------------------------------
       Group A 向右滑出 → 進入第二段語音
       --------------------------------------------------------------- */
    fadeOutGroupA() {
      const groupA = document.getElementById('s3-group-a');
      if (groupA) {
        groupA.classList.remove('fade-in');
        groupA.classList.add('slide-out-right');
      }

      // 滑出完成後（500ms）→ 播放第二段語音
      setAnimTimeout(() => {
        if (groupA) { groupA.classList.remove('active', 'slide-out-right'); }
        s3.playVoice2();
      }, 500);
    },

    /* ---------------------------------------------------------------
       第二段語音：Before that...on January 18th.
       → 5 Jan pill 彈入 → 灰色膠囊長出 → ID Proposal bar 長出 → 18 出現
       --------------------------------------------------------------- */
    playVoice2() {
      const voice2El = document.getElementById('s3-sfx-voice-part2');
      const played = playAudio('s3-sfx-voice-part2');
      let ended = false;

      const onEnd = () => {
        if (ended) return;
        ended = true;
        stopGlow();
        // 語音2 結束 → 等 500ms 後灰色膠囊淡出 → 進入第三段
        setAnimTimeout(() => { s3.fadeOutCapsule(); }, 500);
      };

      if (played && voice2El) {
        startGlowWithAudio(voice2El);
        voice2El.onended = onEnd;
        voice2El.onpause = () => { stopGlow(); };
      }

      // 顯示 Group B + 5 Jan pill 彈入
      setAnimTimeout(() => {
        const groupB = document.getElementById('s3-group-b');
        if (groupB) { groupB.classList.add('active', 'fade-in'); }

        const janPill = document.getElementById('s3-jan-pill');
        if (janPill) janPill.classList.add('pop-in');
        playBloop();
      }, 300);

      // 800ms 後灰色膠囊淡入（與行事曆 icon 同步）
      setAnimTimeout(() => {
        const capsule = document.getElementById('s3-gray-capsule');
        if (capsule) capsule.classList.add('show');
      }, 800);

      // 1300ms 後 ID Proposal bar 長出
      setAnimTimeout(() => {
        const bar = document.getElementById('s3-proposal-bar');
        if (bar) bar.classList.add('grow');
      }, 1300);

      // 1800ms 後 ID Proposal 文字出現
      setAnimTimeout(() => {
        const barText = document.querySelector('#s3-group-b .s3-proposal-text');
        if (barText) barText.classList.add('show');
      }, 1800);

      // 3500ms（語音說到 18th 時）：18 數字出現
      setAnimTimeout(() => {
        const num18 = document.getElementById('s3-number-18');
        if (num18) num18.classList.add('show');
      }, 3500);

      // 安全 fallback（5 秒）
      setAnimTimeout(() => { onEnd(); }, 5000);
    },

    /* ---------------------------------------------------------------
       灰色膠囊淡出（保留 5 Jan pill）→ 進入第三段語音
       --------------------------------------------------------------- */
    fadeOutCapsule() {
      const bar = document.getElementById('s3-proposal-bar');
      const barText = document.querySelector('#s3-group-b .s3-proposal-text');
      const capsule = document.getElementById('s3-gray-capsule');

      // 步驟 1：ID Proposal 文字淡出（300ms）
      if (barText) barText.classList.add('fade-out');

      // 步驟 2：300ms 後灰色膠囊背景+行事曆淡出 + bar 用 clip-path 從左側裁切
      setAnimTimeout(() => {
        if (capsule) capsule.classList.add('fade-bg');

        // 用 clip-path 裁切 bar 左側 → 18 位置完全不動
        if (bar) {
          const barWidth = bar.getBoundingClientRect().width;
          const circleSize = 34; // 目標圓形直徑（= bar height）
          const clipLeft = barWidth - circleSize;

          // 先設定 inline style 覆蓋動畫 fill，再移除 grow class
          bar.style.maxWidth = 'none';
          bar.style.opacity = '1';
          bar.style.padding = '0 7.5px';
          bar.classList.remove('grow');
          bar.classList.add('shrink-to-circle');
          // 設定 clip-path 起點（無裁切）
          bar.style.clipPath = 'inset(0 0 0 0 round 17px)';
          void bar.offsetWidth;
          // 動畫：從左裁切到只剩右側 36px 圓
          bar.style.transition = 'clip-path 0.6s ease-in-out';
          bar.style.clipPath = 'inset(0 0 0 ' + clipLeft + 'px round 17px)';
        }

        // 步驟 3：縮小完成（700ms 後）→ 圓形往右滑動到膠囊右端
        setAnimTimeout(() => {
          // 在滑動開始同時，將 18 置中對齊（微調被大幅滑動掩蓋）
          const num18 = document.getElementById('s3-number-18');
          if (num18 && bar) {
            num18.style.position = 'absolute';
            num18.style.right = '0';
            num18.style.top = '0';
            num18.style.width = '34px';
            num18.style.height = bar.offsetHeight + 'px';
            num18.style.display = 'flex';
            num18.style.alignItems = 'center';
            num18.style.justifyContent = 'center';
          }
          if (bar && capsule) {
            const barRect = bar.getBoundingClientRect();
            const capsuleRect = capsule.getBoundingClientRect();
            // barRect.right = bar 未裁切的右邊（= 可見圓的右邊）
            const moveX = capsuleRect.right - barRect.right - 4;
            bar.style.transition = 'transform 0.4s ease-in-out';
            bar.style.transform = 'translateX(' + moveX + 'px)';
          }

          // 步驟 4：移動完成（450ms 後）→ 切換到 Group C
          setAnimTimeout(() => {
            const groupB = document.getElementById('s3-group-b');
            if (groupB) { groupB.classList.remove('active', 'fade-in'); }

            const groupC = document.getElementById('s3-group-c');
            if (groupC) { groupC.classList.add('active'); groupC.style.opacity = '1'; }

            s3.playVoice3();
          }, 450);
        }, 700);
      }, 300);
    },

    /* ---------------------------------------------------------------
       第三段語音：Then, we have one week to prepare...
       → Group C 出現（5 Jan + Final Proposal + CMF + Artwork + 18 circle）
       --------------------------------------------------------------- */
    playVoice3() {
      const voice3El = document.getElementById('s3-sfx-voice-part3');
      const played = playAudio('s3-sfx-voice-part3');
      let ended = false;

      const onEnd = () => {
        if (ended) return;
        ended = true;
        stopGlow();
        // 語音3 結束 → 等 3000ms 後播放 "Is there anything else?"
        setAnimTimeout(() => { s3.playAnythingElse(); }, 3000);
      };

      if (played && voice3El) {
        startGlowWithAudio(voice3El);
        voice3El.onended = onEnd;
        voice3El.onpause = () => { stopGlow(); };
      }

      // 語音 "Then" (~200ms) → Final Proposal 彈入 + 音效
      setAnimTimeout(() => {
        const el = document.getElementById('s3-c-final');
        if (el) el.classList.add('pop-in');
        playBloop();
      }, 200);

      // 語音 "CMF" (~3000ms) → CMF 彈入 + 音效
      setAnimTimeout(() => {
        const el = document.getElementById('s3-c-cmf');
        if (el) el.classList.add('pop-in');
        playBloop();
      }, 3000);

      // 語音 "artwork" (~3800ms) → Artwork 彈入 + 音效
      setAnimTimeout(() => {
        const el = document.getElementById('s3-c-artwork');
        if (el) el.classList.add('pop-in');
        playBloop();
      }, 3800);

      // 語音接近結尾 (~4200ms) → 18 圓形 pill 彈入
      setAnimTimeout(() => {
        const el = document.getElementById('s3-circle-18');
        if (el) el.classList.add('pop-in');
      }, 4200);

      // 安全 fallback（6 秒）
      setAnimTimeout(() => { onEnd(); }, 6000);
    },

    /* ---------------------------------------------------------------
       最後一段：Is there anything else I can help you with?
       --------------------------------------------------------------- */
    playAnythingElse() {
      // 先播放鈴聲 + 光效
      playAudio('s3-sfx-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 800ms 後播放語音（與 S2 page4 停頓一致）
      setAnimTimeout(() => {
        const voiceEl = document.getElementById('s3-sfx-voice-anything-else');
        const played = playAudio('s3-sfx-voice-anything-else');

        if (played && voiceEl) {
          startGlowWithAudio(voiceEl);
          voiceEl.onended = () => { stopGlow(); isAnimating = false; tryShowPrompter(); };
          voiceEl.onpause = () => { stopGlow(); };
        } else {
          setAnimTimeout(() => { stopGlow(); isAnimating = false; tryShowPrompter(); }, 2000);
        }
      }, 800);

      // fallback
      setAnimTimeout(() => { stopGlow(); isAnimating = false; }, 5000);
    },

    /* ---------------------------------------------------------------
       S3 第三頁動畫：bell → 語音 → 膠囊依序離場 → AI exit → Compal
       --------------------------------------------------------------- */
    animateSlide3() {
      const page3 = document.getElementById('s3-pill-page-3');
      if (!page3) return;

      // 播放 notification bell + 光效
      playAudio('s3-sfx-bell');
      const pg = getPillGlow();
      if (pg) pg.classList.add('active');

      // 800ms 後播放語音 part4
      setAnimTimeout(() => { s3.playVoice4(); }, 800);
    },

    /* ---------------------------------------------------------------
       第四段語音：You're welcome Anna. Let me know if you need help
       preparing for the meeting with Jenny in the noon.
       → 膠囊由左往右依序消失 → AI icon 退場 → Compal 淡入
       --------------------------------------------------------------- */
    playVoice4() {
      const voice4El = document.getElementById('s3-sfx-voice-part4');
      const played = playAudio('s3-sfx-voice-part4');
      const page3 = document.getElementById('s3-pill-page-3');
      if (!page3) return;

      const miniPills = page3.querySelectorAll('.mini-pill');
      const circle18 = page3.querySelector('.s3-p3-circle-18');
      const aiIcon = page3.querySelector('.s3-ai-icon-p3');
      const logo = page3.querySelector('.s3-logo-p3');
      let ended = false;

      const startPillExit = () => {
        // 膠囊依序由左往右 slide-out
        const totalItems = miniPills.length + 1; // +1 for circle-18
        const duration = (voice4El && voice4El.duration && isFinite(voice4El.duration))
          ? Math.min((voice4El.duration * 1000 * 0.5) / totalItems, 300) : 200;

        miniPills.forEach((pill, i) => {
          setAnimTimeout(() => { pill.classList.add('slide-out'); }, duration * i);
        });

        // 18 圓形最後消失
        setAnimTimeout(() => {
          if (circle18) circle18.classList.add('slide-out');
        }, duration * miniPills.length);
      };

      const onEnd = () => {
        if (ended) return;
        ended = true;
        stopGlow();
        // AI icon 退場 → Compal logo 淡入
        s3.startPage3IconExit(aiIcon, logo, page3);
      };

      if (played && voice4El) {
        startGlowWithAudio(voice4El);
        if (voice4El.duration && isFinite(voice4El.duration)) { startPillExit(); }
        else {
          voice4El.addEventListener('loadedmetadata', startPillExit, { once: true });
          setAnimTimeout(() => {
            if (!miniPills[0].classList.contains('slide-out')) startPillExit();
          }, 300);
        }
        voice4El.onended = onEnd;
        voice4El.onpause = () => { stopGlow(); };
      } else {
        // 無語音 fallback
        const pg = getPillGlow();
        if (pg) pg.classList.add('active');
        startPillExit();
        const totalDelay = 200 * (miniPills.length + 1) + 400;
        setAnimTimeout(() => { onEnd(); }, totalDelay);
      }

      // 安全 fallback
      setAnimTimeout(() => { onEnd(); }, 8000);
    },

    /* ---------------------------------------------------------------
       AI icon 退場 → Compal logo 淡入
       --------------------------------------------------------------- */
    startPage3IconExit(aiIcon, logo, page3) {
      const wrapper = page3.querySelector('.s3-p3-pills');
      if (wrapper) wrapper.style.display = 'none';
      const circle18 = page3.querySelector('.s3-p3-circle-18');
      if (circle18) circle18.style.display = 'none';

      if (aiIcon) aiIcon.classList.add('exit');
      setAnimTimeout(() => {
        const aiWrapper = page3.querySelector('.ai-icon-wrapper');
        if (aiWrapper) aiWrapper.style.display = 'none';
        if (logo) logo.classList.add('fade-in');
        setAnimTimeout(() => { isAnimating = false; }, 600);
      }, 650);
    },

    /* ---------------------------------------------------------------
       S3 第三頁重置
       --------------------------------------------------------------- */
    resetSlide3() {
      const page3 = document.getElementById('s3-pill-page-3');
      if (!page3) return;

      page3.querySelectorAll('.mini-pill').forEach(el => el.classList.remove('slide-out'));
      const circle18 = page3.querySelector('.s3-p3-circle-18');
      if (circle18) { circle18.classList.remove('slide-out'); circle18.style.display = ''; }
      const aiIcon = page3.querySelector('.s3-ai-icon-p3');
      if (aiIcon) aiIcon.classList.remove('exit');
      const logo = page3.querySelector('.s3-logo-p3');
      if (logo) logo.classList.remove('fade-in');
      const wrapper = page3.querySelector('.s3-p3-pills');
      if (wrapper) wrapper.style.display = '';
      const aiWrapper = page3.querySelector('.ai-icon-wrapper');
      if (aiWrapper) aiWrapper.style.display = '';

      stopAudio('s3-sfx-bell');
      stopAudio('s3-sfx-voice-part4');
      isAnimating = false;
    },

    animations: {
      1: () => s3.animateSlide2(),
      2: () => s3.animateSlide3(),
    },

    resets: {
      1: () => s3.resetSlide2(),
      2: () => s3.resetSlide3(),
    },

    specialTransitions: {},
    skipPillPageSwitch: {},
  };

  /* ================================================================
     Script 對應表
     ================================================================ */

  /* ================================================================
     Script 4：即時語音對話（Gemini Live）
     ================================================================ */

  const s4 = {
    pageCount: 1,
    resets: {},
  };

  /* --- S4 Aurora 光效控制 --- */
  /* S4 流體預設色板 */
  const s4Presets = {
    listening: {
      blur: 50, speed: 16, noise: 0.35,
      c1: '#0055ff', c2: '#00bbff', c3: '#6a00ff', c4: '#cdcdcd'
    },
    speaking: {
      blur: 50, speed: 16, noise: 0.4,
      c1: '#ff1453', c2: '#4d00ff', c3: '#0066ff', c4: '#ff4d00'
    }
  };

  const s4Aurora = {
    el: null,

    /** 啟動流體效果（進入 S4 時） */
    start() {
      this.el = document.getElementById('s4-aurora');
      if (!this.el) return;
      this.el.classList.add('active');
      this._applyPreset('listening'); // 預設聆聽模式
    },

    /** 停止流體效果（離開 S4 時） */
    stop() {
      if (!this.el) return;
      this.el.classList.remove('active');
      this.el = null;
    },

    /** 切換為 AI 回答模式（科技桃紅紫） */
    setSpeaking() {
      this._applyPreset('speaking');
    },

    /** 切換為聆聽模式（冰藍紫） */
    setListening() {
      this._applyPreset('listening');
    },

    /** 根據音量動態微調 blur（volume: 0~1） */
    updateVolume(volume) {
      if (!this.el) return;
      // 音量越大 blur 越小 → 輪廓越銳利；音量小則更柔和
      const baseBlur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s4-blur')) || 35;
      const dynamicBlur = baseBlur + (1 - volume) * 15 - volume * 10;
      this.el.querySelector('.s4-fluid-canvas').style.filter = `blur(${Math.max(10, dynamicBlur).toFixed(0)}px)`;
    },

    /** 套用預設色板（透過 CSS 變數） */
    _applyPreset(name) {
      const p = s4Presets[name];
      if (!p) return;
      const r = document.documentElement.style;
      r.setProperty('--s4-blur', p.blur + 'px');
      r.setProperty('--s4-anim-speed', p.speed + 's');
      r.setProperty('--s4-noise-opacity', p.noise);
      r.setProperty('--s4-c1', p.c1);
      r.setProperty('--s4-c2', p.c2);
      r.setProperty('--s4-c3', p.c3);
      r.setProperty('--s4-c4', p.c4);
    }
  };

  // Gemini Live 回調：AI 說話 / 結束 + 音量
  if (window.geminiLive) {
    window.geminiLive.onAiSpeakingStart = () => {
      if (currentScript !== '4') return;
      // 膠囊外框光暈
      const pillGlow = getPillGlow();
      if (pillGlow) {
        pillGlow.classList.add('active');
        pillGlow.style.opacity = '0.8';
      }
      // Aurora 切換為回答模式
      s4Aurora.setSpeaking();
    };

    window.geminiLive.onAiSpeakingEnd = () => {
      if (currentScript !== '4') return;
      const pillGlow = getPillGlow();
      if (pillGlow) {
        pillGlow.classList.remove('active');
        pillGlow.style.opacity = '';
      }
      // Aurora 切換為聆聽模式
      s4Aurora.setListening();
    };

    // 音量回調：驅動 aurora 光團大小
    window.geminiLive.onVolumeUpdate = (volume, source) => {
      if (currentScript !== '4') return;
      s4Aurora.updateVolume(volume);
    };
  }

  /* ================================================================
     Script 0：待機輪播（COMPAL ↔ 彩色膠囊，每 2 秒切換）
     ================================================================ */

  let s0IntervalId = null;

  function startS0Carousel() {
    stopS0Carousel();
    const page1 = document.getElementById('s0-pill-page-1');
    const page2 = document.getElementById('s0-pill-page-2');
    if (!page1 || !page2) return;

    let showingLogo = true;
    s0IntervalId = setInterval(() => {
      showingLogo = !showingLogo;
      page1.classList.toggle('active', showingLogo);
      page2.classList.toggle('active', !showingLogo);
    }, 5000);
  }

  function stopS0Carousel() {
    if (s0IntervalId !== null) {
      clearInterval(s0IntervalId);
      s0IntervalId = null;
    }
  }

  const s0 = {
    pageCount: 1,
    animations: {},
    resets: {},
    specialTransitions: {},
    skipPillPageSwitch: {},
  };

  const scripts = {
    '0': s0,
    '1': s1,
    '2': s2,
    '3': s3,
    '4': s4,
  };

  function getScriptConfig() {
    return scripts[currentScript] || null;
  }

  /* ============================
     翻頁核心
     ============================ */

  function showSlide(index) {
    // 0. 隱藏提詞 + 停止下一頁按鈕光暈
    hidePrompter();

    // 1. 強制清除所有排程中的動畫（解決計時器殘留問題）
    clearAllAnimTimeouts();

    // 2. 強制停止所有播放中的音效
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    stopGlow();
    isAnimating = false;

    const slides = getSlides();
    const pillPages = getPillPages();
    const config = getScriptConfig();
    const leavingIndex = currentIndex;
    const transKey = `${leavingIndex}->${index}`;

    // 3. 重置離開頁面的動畫
    if (config) {
      const isSpecial = config.specialTransitions && config.specialTransitions[transKey];
      if (!isSpecial) {
        const resetFn = config.resets && config.resets[leavingIndex];
        if (resetFn) resetFn();
      }
    }

    // 切換背景
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });

    // 切換膠囊內容
    const skipPill = config && config.skipPillPageSwitch && config.skipPillPageSwitch[transKey];
    if (!skipPill) {
      pillPages.forEach((page, i) => {
        page.classList.toggle('active', i === index);
      });
    }

    currentIndex = index;
    pageIndicator.textContent = `${currentIndex + 1} / ${slides.length}`;

    // 觸發進入頁面的動畫
    if (config) {
      const animFn = config.animations && config.animations[currentIndex];
      if (animFn) {
        setAnimTimeout(animFn, 100);
      } else {
        // 無動畫的頁面（如首頁）：直接顯示提詞或光暈
        const map = PROMPTER_MAP[currentScript];
        if (map && map[currentIndex]) {
          showPrompter(map[currentIndex]);
        } else if (map && map[currentIndex] === null) {
          // 無提詞但需要光暈提示（如 S2 page1）
          if (btnNextEl) btnNextEl.classList.add('glow-hint');
        }
      }
    }
  }

  function nextSlide() {
    const slides = getSlides();
    if (currentIndex < slides.length - 1) showSlide(currentIndex + 1);
  }

  function prevSlide() {
    if (currentIndex > 0) showSlide(currentIndex - 1);
  }

  /* ============================
     Script 切換
     ============================ */

  function switchScript(scriptNum) {
    if (scriptNum === currentScript) return;

    // 清除所有排程計時器
    clearAllAnimTimeouts();

    // 停止所有音效
    document.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
    stopGlow();

    // 重置當前 Script 的動畫
    const config = getScriptConfig();
    if (config && config.resets) {
      Object.values(config.resets).forEach(fn => fn());
    }

    // 隱藏當前 Script，重置其頁面狀態
    const oldContainer = getActiveContainer();
    if (oldContainer) {
      oldContainer.classList.remove('active');
      // 重置所有 pill-page 到第一頁
      oldContainer.querySelectorAll('.pill-page').forEach((p, i) => {
        p.classList.toggle('active', i === 0);
      });
      oldContainer.querySelectorAll('.slide').forEach((s, i) => {
        s.classList.toggle('active', i === 0);
      });
    }

    // 切換 Script
    currentScript = scriptNum;
    currentIndex = 0;

    // 顯示新 Script
    const newContainer = getActiveContainer();
    if (newContainer) newContainer.classList.add('active');

    // S0：進入時啟動輪播，離開時停止
    if (scriptNum === '0') {
      startS0Carousel();
    } else {
      stopS0Carousel();
    }

    // S4：進入時自動連線 + 啟動 aurora，離開時斷線 + 停止 aurora
    if (scriptNum === '4') {
      s4Aurora.start();
      if (window.geminiLive) window.geminiLive.connect();
    }
    if (scriptNum !== '4') {
      s4Aurora.stop();
      if (window.geminiLive) window.geminiLive.cleanup();
    }

    // 更新 Script 名稱標示
    const scriptLabel = document.getElementById('script-label');
    if (scriptLabel) scriptLabel.textContent = `Script ${scriptNum}`;

    // 更新按鈕狀態
    document.querySelectorAll('.script-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.script === scriptNum);
    });

    // Script 0 隱藏翻頁控制
    const controlsEl = document.querySelector('.controls');
    if (controlsEl) controlsEl.classList.toggle('hidden', scriptNum === '0');

    // 更新指示器
    const slides = getSlides();
    pageIndicator.textContent = `1 / ${slides.length}`;

    isAnimating = false;

    // 提詞機：顯示新 Script 第一頁的提詞（若有）
    hidePrompter();
    const map = PROMPTER_MAP[currentScript];
    if (map && map[0]) {
      showPrompter(map[0]);
    } else if (map && map[0] === null) {
      if (btnNextEl) btnNextEl.classList.add('glow-hint');
    }
  }

  /* ============================
     事件綁定
     ============================ */

  btnNext.addEventListener('click', nextSlide);
  btnPrev.addEventListener('click', prevSlide);

  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowRight': case ' ':
        e.preventDefault(); nextSlide(); break;
      case 'ArrowLeft':
        e.preventDefault(); prevSlide(); break;
      case '0': case '1': case '2': case '3': case '4':
        e.preventDefault(); switchScript(e.key); break;
    }
  });

  // Script 選擇器按鈕
  document.querySelectorAll('.script-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchScript(btn.dataset.script);
    });
  });

  // 初始化
  showSlide(0);
  startS0Carousel();
  // Script 0 預設隱藏翻頁控制
  const controlsInit = document.querySelector('.controls');
  if (controlsInit) controlsInit.classList.add('hidden');
})();
