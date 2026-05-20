"""
統一產生所有 TTS 語音（Rasalgethi 男聲）
輸出至 audio/voice/ 資料夾
"""

import os
import sys
import struct
import io
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "audio", "voice")

# 所有語音清單：(檔名, 文字)
TTS_LIST = [
    # ---- Script 1 ----
    ("s1-greeting.wav",    "Hi Ana. How can I help you?"),
    ("s1-transition.wav",  "Good morning, Ana. You've got three schedules today."),
    ("s1-schedule-1.wav",  "First, meeting with Jenny, likely a calendar appointment."),
    ("s1-schedule-2.wav",  "Second, grocery, your shopping list or errand."),
    ("s1-schedule-3.wav",  "Third, call Tom, a phone reminder perhaps for the mock-up schedule."),
    ("s1-closing.wav",     "Is there anything else I can help you with?"),
    ("s1-farewell.wav",    "You're welcome. Have a productive day, Ana."),

    # ---- Script 2 ----
    ("s2-greeting.wav",          "Hi Anna, I just received an email from Tom about the Mockup release schedule for February 8th."),
    ("s2-details-question.wav",  "Would you like to know the full details?"),
    ("s2-details-answer.wav",    "It outlines the Time slots for generating and delivering the rendering images, plus a final proposal review checkpoint."),
    ("s2-calendar-question.wav", "Would you like me to add it to your calendar with a reminder?"),
    ("s2-calendar-confirm.wav",  "I'll add the schedule and set a reminder for you."),
    ("s2-anything-else.wav",     "Is there anything else I can help you with?"),
    ("s2-farewell.wav",          "You're welcome. Have a productive day, Anna."),

    # ---- Script 3 ----
    ("s3-part1.wav",          "Sure, based on Tom's mail, we should release the mockup data on February 8th."),
    ("s3-part2.wav",          "Before that, we need to get design approve on January 18th."),
    ("s3-part3.wav",          "Then, we have one week to prepare for the CMF and artwork document for the next week."),
    ("s3-anything-else.wav",  "Is there anything else I can help you with?"),
    ("s3-farewell.wav",       "You're welcome Anna. Let me know if you need help preparing for the meeting with Jenny in the noon."),
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
    print("重新產生所有 TTS 語音（Rasalgethi 男聲）")
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
