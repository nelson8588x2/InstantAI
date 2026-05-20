/**
 * AudioWorklet Processor：擷取麥克風 PCM 資料
 * 從原生取樣率（通常 48kHz）降採樣到 16kHz
 * 輸出 Int16 PCM 供 Gemini Live API 使用
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    // sampleRate 是 AudioWorklet 全域變數，等於 AudioContext 的取樣率
    this._ratio = sampleRate / this._targetRate;
    this._residual = 0; // 用於處理非整數倍降採樣
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const float32 = input[0];

    if (this._ratio <= 1) {
      // 不需降採樣（AudioContext 已經是 16kHz 或更低）
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    } else {
      // 簡單降採樣：每隔 ratio 個樣本取一個
      const outLen = Math.floor((float32.length + this._residual) / this._ratio);
      if (outLen <= 0) {
        this._residual += float32.length;
        return true;
      }
      const pcm16 = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const srcIdx = Math.floor(i * this._ratio - this._residual);
        const idx = Math.max(0, Math.min(float32.length - 1, srcIdx));
        const s = Math.max(-1, Math.min(1, float32[idx]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this._residual = (this._residual + float32.length) % this._ratio;
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
