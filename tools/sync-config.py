"""
將 .env 中的 GEMINI_API_KEY 同步到 js/config.js
執行方式：python tools/sync-config.py
"""

import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(PROJECT_ROOT, ".env")
CONFIG_PATH = os.path.join(PROJECT_ROOT, "js", "config.js")


def main():
    # 讀取 .env
    api_key = None
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    if key.strip() == "GEMINI_API_KEY":
                        api_key = val.strip()
                        break

    if not api_key:
        print("錯誤：.env 中找不到 GEMINI_API_KEY")
        return

    # 寫入 config.js
    config_content = f"""/**
 * 專案設定檔 — 此檔案不應提交至版本控制
 * 由 tools/sync-config.py 自動產生
 */
window.APP_CONFIG = {{
  GEMINI_API_KEY: '{api_key}',
}};
"""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(config_content)

    print(f"已同步 API Key 到 {CONFIG_PATH}")
    print(f"Key: {api_key[:8]}...{api_key[-4:]}")


if __name__ == "__main__":
    main()
