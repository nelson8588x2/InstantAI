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

3. 建立 commit（請根據實際變更內容撰寫繁體中文 commit message）：
```bash
git commit -m "描述本次變更"
```

4. Push 到 GitHub main branch：
```bash
git push origin main
```

## 注意事項
- commit message 使用繁體中文
- 確認 `.gitignore` 中的敏感檔案（`.env`, `js/config.js`）沒有被加入
- Push 成功後 Render 會自動重新部署（Static Site）
