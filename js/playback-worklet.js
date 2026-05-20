/**
 * AudioWorklet Processor：連續播放 PCM 音訊
 * 使用環形佇列避免 chunk 之間的間隙和爆音
 */
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 環形緩衝區（約 10 秒 @ 24kHz）
    this._buf = new Float32Array(240000);
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0; // 目前緩衝區中的樣本數

    this.port.onmessage = (e) => {
      if (e.data === 'interrupt') {
        // 清空佇列
        this._writePos = 0;
        this._readPos = 0;
        this._count = 0;
        return;
      }
      // e.data 是 Float32Array
      const samples = e.data;
      for (let i = 0; i < samples.length; i++) {
        if (this._count < this._buf.length) {
          this._buf[this._writePos] = samples[i];
          this._writePos = (this._writePos + 1) % this._buf.length;
          this._count++;
        }
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    for (let i = 0; i < output.length; i++) {
      if (this._count > 0) {
        output[i] = this._buf[this._readPos];
        this._readPos = (this._readPos + 1) % this._buf.length;
        this._count--;
      } else {
        output[i] = 0;
      }
    }
    // 通知主執行緒目前緩衝區狀態
    if (currentFrame % 12000 === 0) {
      this.port.postMessage({ buffered: this._count });
    }
    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
