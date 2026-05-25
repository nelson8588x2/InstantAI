"""
產生 S2 拆分語音（greeting-1/2, page3-1/2）
將每句話拆成兩段獨立錄音，解決斷句時間不準問題
"""

import os
import sys
import struct
import io
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "audio", "voice")

# 拆分語音清單
TTS_LIST = [
    ("s2-greeting-1.wav", "Hi Anna, I just received an email from Tom"),
    ("s2-greeting-2.wav", "about the Mockup release schedule for February 8th."),
    ("s2-details-answer-1.wav", "It outlines the Time slots for generating and delivering"),
    ("s2-details-answer-2.wav", "the rendering images, plus a final proposal review checkpoint."),
]


def pcm_to_wav(pcm_data, sample_rate=24000, num_channels=1, bits_per_sample=16):
    """將 raw PCM 資料轉換為 WAV 格式"""
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_data)

    buf = io.BytesIO()
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + data_size))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', num_channels))
    buf.write(struct.pack('<I', sample_rate))
    buf.write(struct.pack('<I', byte_rate))
    buf.write(struct.pack('<H', block_align))
    buf.write(struct.pack('<H', bits_per_sample))
    buf.write(b'data')
    buf.write(struct.pack('<I', data_size))
    buf.write(pcm_data)
    return buf.getvalue()


def load_env():
    """從專案根目錄 .env 載入環境變數"""
    env_path = os.path.join(PROJECT_ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ.setdefault(key.strip(), val.strip())


def main():
    load_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("錯誤：請在 .env 檔設定 GEMINI_API_KEY 或設定環境變數")
        sys.exit(1)

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("請先安裝套件：pip install google-genai")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 60)
    print("產生 S2 拆分語音（Rasalgethi 男聲）")
    print(f"輸出目錄：{OUTPUT_DIR}")
    print(f"共 {len(TTS_LIST)} 個語音")
    print("=" * 60)

    for idx, (filename, text) in enumerate(TTS_LIST):
        output_path = os.path.join(OUTPUT_DIR, filename)

        print(f"\n[{idx+1}/{len(TTS_LIST)}] {filename}")
        print(f"  文字：{text}")

        for attempt in range(5):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash-preview-tts",
                    contents=text,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name="Rasalgethi",
                                )
                            )
                        ),
                    ),
                )
                break
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    wait = 65
                    print(f"  配額超限，等待 {wait} 秒後重試 ({attempt+1}/5)...")
                    time.sleep(wait)
                else:
                    raise
        else:
            print(f"  錯誤：{filename} 超過重試次數，跳過")
            continue

        audio_data = response.candidates[0].content.parts[0].inline_data.data
        wav_data = pcm_to_wav(audio_data)

        with open(output_path, "wb") as f:
            f.write(wav_data)
        print(f"  已儲存：{output_path} ({len(wav_data)} bytes)")

        # 請求間隔避免觸發配額限制
        if idx < len(TTS_LIST) - 1:
            time.sleep(8)

    print("\n" + "=" * 60)
    print("全部完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
