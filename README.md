# 一笔打烊

基于 **Planck.js（Box2D）刚体物理 + Canvas 2D** 的正侧视纸板商业街拆楼解谜游戏。首关“保龄球馆的最后一单”中，玩家划出一条最长三格（`144` 逻辑单位）的直线切断卡扣或楼块，由真实刚体、铰链、冲量断裂与一次性弹板驱动整条连锁倒塌。[在线游玩](https://himentpear.github.io/one-stroke-street/)

## 安装与运行

环境要求 Node.js `22.18.0`（见 `.nvmrc`）与 `npm@11.7.0`。

```sh
git clone https://github.com/himentpear/one-stroke-street.git
cd one-stroke-street
npm ci
npm run setup:browsers
npm run dev
```

- 本地开发：`npm run dev`（默认 <http://127.0.0.1:5173/>；手机同网联调用 `npm run dev -- --host 0.0.0.0 --port 5173`）
- 单文件构建：`npm run build`（生成字节完全一致的根目录 `index.html` 与 `dist/index.html`，双击 `index.html` 可断网离线游玩）
- 产物预览：`npm run preview`（默认 <http://127.0.0.1:4173/>）
- 浏览器回归测试：`npm test`（覆盖桌面 Chromium `1280×800`、移动 Chromium `360×780` 含真实 CDP 触摸输入、iPhone 尺寸 WebKit `390×844`）

## 架构与调试

| 模块 | 职责 |
| --- | --- |
| `src/level.js` | 可调关卡数据：部件位置、尺寸、质量、断裂冲量阈值、弹板速度与笔长上限 |
| `src/stroke.js` | 3 格长度截断与切线命中判定 |
| `src/physics.js` | Planck.js 世界、`1/120` 秒固定步长、铰链/焊接关节、冲量去重断裂、CCD 连续碰撞检测与一次弹板 |
| `src/render.js` | HiDPI Canvas 2D 纸板街景、帧间插值、6 片/房视觉纸屑与物理调试叠层 |
| `src/audio.js` | 玩家手动开启的 Web Audio 合成音效（卡扣、撕纸、弹板、落地） |
| `src/game.js` | Pointer Events 坐标映射、80ms 顿帧（不积压步数）、重画与状态管理 |

**物理调试与关卡调参**：
- 点击页面底部的 **物理调试** 按钮、按 `D` 键或在地址后追加 `?debug=1`，即可查看所有刚体碰撞形状、当前关节、接触冲量数值与断裂顺序（`#1`–`#4`）。
- 直接修改 `src/level.js` 中的 `rooms[].breakImpulse`、`spring.launchVx/launchVy`、`ball.density` 等参数即可实时调参，或在浏览器控制台调用 `window.__OSS__.setLevelOverrides({ spring: { left: 320, right: 411 } })` 验证场景几何对物理结果的影响。

## 发布与回滚

仓库使用 GitHub Actions（`.github/workflows/pages.yml`）作为 GitHub Pages 发布源：拉取请求仅执行 `npm ci`、构建与 Playwright 测试；推送至 `main` 并验证通过后仅上传 `dist/` 以官方 OIDC 短期凭据部署。

```sh
# 发布
git push origin main

# 线上 SHA-256 校验（PowerShell）
curl.exe -fsSL https://himentpear.github.io/one-stroke-street/ -o "$env:TEMP\pages-live.html"
Get-FileHash index.html, dist/index.html, "$env:TEMP\pages-live.html" -Algorithm SHA256

# 回滚
git revert <commit-sha> --no-edit && git push origin main
```
