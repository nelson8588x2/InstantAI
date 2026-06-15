---
description: Git commit 並 push 到 GitHub（部署到 Render）
---

# Deploy Workflow

將目前的變更 commit 並 push 到 GitHub，Render 會自動從 main branch 部署。

## 步驟

1. 確認目前 git 狀態，檢查有無未追蹤或修改的檔案：
// turbo
```bash
git status
```

2. 將所有變更加入暫存區：
// turbo
```bash
git add -A
```

3. 檢視本次變更的具體內容（用於撰寫 commit message）：
// turbo
```bash
git diff --cached --stat
```

4. 查看詳細變更（若需要了解程式碼改動細節）：
// turbo
```bash
git diff --cached
```

5. 根據步驟 3-4 看到的變更內容，撰寫精確的繁體中文 commit message 並 commit：
```bash
git commit -m "描述本次變更的具體內容"
```

6. Push 到 GitHub main branch：
```bash
git push origin main
```

## 注意事項
- commit message 使用繁體中文，簡潔描述本次變更的核心內容
- 確認 `.gitignore` 中的敏感檔案（`.env`, `js/config.js`）沒有被加入
- Push 成功後 Render 會自動重新部署（Web Service）
- 若有多個不相關的改動，考慮分開多次 commit
