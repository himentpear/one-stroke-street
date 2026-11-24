# 一笔打烊

2D 纸板街区 H5 解谜游戏。用一笔划断卡扣或拆掉亮窗房，让巨型保龄球招牌撞穿街两边的四间店铺。[在线游玩](https://himentpear.github.io/one-stroke-street/)

## 从零安装

项目要求 Node.js `22.18.0`（见 `.nvmrc`）与 `npm@11.7.0`（见 `package.json`）。请先安装或切换到 `.nvmrc` 指定的 Node.js `22.18.0`，再克隆仓库并安装依赖与测试浏览器：

```sh
git clone https://github.com/himentpear/one-stroke-street.git
cd one-stroke-street
node --version
npm install --global npm@11.7.0
npm ci
npm run setup:browsers
```

Linux（如 Ubuntu / WSL / CI）首次安装 Playwright 浏览器与系统依赖时请使用：

```sh
npx playwright install --with-deps chromium webkit
```

## 本地启动、构建与预览

```sh
# 启动本地开发服务（默认 http://127.0.0.1:5173/，刷新页面实时读取 src/）
npm run dev

# 构建单文件成品（生成字节完全一致的根目录 index.html 与 dist/index.html）
npm run build

# 预览构建产物（默认 http://127.0.0.1:4173/，静态提供 dist/index.html）
npm run preview
```

也可以不启动本地服务器，直接双击仓库根目录的 `index.html`（以 `file://` 离线打开）完整试玩。构建器会将 CSS、SVG 与 esbuild 打包后的脚本全部内联到单个 HTML 中；修改 `src/` 后请运行 `npm run build` 并一并提交更新后的 `index.html`。

## 手机同网联调

确保手机与开发电脑连入同一 Wi-Fi，先查询电脑局域网 IP：

```sh
# Windows (PowerShell / CMD)
ipconfig

# macOS (默认 Wi-Fi 网卡 en0)
ipconfig getifaddr en0

# Linux
hostname -I
```

再监听所有网卡启动开发服务或预览服务：

```sh
# 开发联调（手机访问 http://<局域网IP>:5173/）
npm run dev -- --host 0.0.0.0 --port 5173
```

```sh
# 产物预览联调（手机访问 http://<局域网IP>:4173/）
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

在手机浏览器中打开 `http://<局域网IP>:5173/`（预览模式对应 `:4173/`）。如无法访问，请检查电脑防火墙是否放行对应 TCP 端口。

## 自动化测试与验证范围说明

```sh
npm test
```

`npm test` 会先执行 `npm run build`，随后在 `/one-stroke-street/` 子路径下运行三个 Playwright 项目：`desktop-chromium`（`1280×800`）、`mobile-chromium`（`360×780`）和 `mobile-webkit`（`390×844`）。

- **浏览器模拟范围**（Playwright 自动化覆盖）：
  - **视口缩放**：验证 `1280×800`、`360×780`、`390×844` 下的自适应布局与无横向滚动溢出。
  - **SVG CTM 坐标映射**：通过 `getScreenCTM()` 换算指针坐标到 `600 × 328` 逻辑场景，覆盖 `144` 单位笔长上限、拖拽时 `.stroke-hit` 命中高亮与三类拆扣/空划结果。
  - **Pointer / Touch / Cancel 事件**：覆盖指针与触摸拖拽、`pointercancel` / CDP `touchCancel` 中断后清理预览并保留笔数，以及键盘按钮复用同一拆解逻辑。
  - **减少动态效果（Reduced Motion）立即结算**：`prefers-reduced-motion: reduce` 下复用相同的 `1/120` 秒固定步长推进至终局；同时在正常动效下覆盖倒塌中途点击“重画”立即重置及完整通关过程。
  - **子路径与离线 `file://`**：验证 GitHub Pages 项目子路径 `/one-stroke-street/` 下的静态服务表现，以及断网打开 `index.html`（`file://`）和离线刷新通关、零外部 HTTP 请求、零页面报错。
- **真机测试范围**（需通过上文“手机同网联调”或线上 Pages 在物理设备手工实测）：
  - **物理静音开关与 Web Audio 解锁**：iOS Safari / Android Chrome 下实体静音拨片对音量输出的影响，以及用户点击开启音效按钮后的 `AudioContext.resume()` 首次手势解锁行为。
  - **刘海屏 / 安全区触控手感**：真机 `env(safe-area-inset-*)` 安全区留白、单手握持与边缘按钮（`44px` 以上热区）的实际触控舒适度。
  - **系统边缘侧滑返回干扰**：真机浏览器左右边缘侧滑返回手势与画线起始拖动之间的手势竞争与 `touch-action: none` 实机表现。
  - **真实 GPU 与帧节奏**：物理设备实际刷新率、节电模式与真实移动 GPU 渲染下的 `requestAnimationFrame` 帧表现。

## 游戏架构

| 层 | 入口 | 职责 |
| --- | --- | --- |
| 页面与美术 | `src/page.html`、`src/style.css`、`src/scene.svg` | 响应式界面、四种基色、可复用纸板部件、手机触控区域 |
| 关卡与命中 | `src/level.js` | `600 × 328` 逻辑场景、四间亮房、两枚卡扣、弹板、`144` 单位笔长、相交判定 |
| 物理 | `src/physics.js` | 维护单局状态，每 `1/120` 秒推进翻转、滚动、重力与碰撞并产生事件 |
| 输入与回合 | `src/game.js` | 换算 SVG 坐标，处理落笔、指针取消、重画与结算，键盘与触屏共用逻辑 |
| 画面与声音 | `src/view.js`、`src/audio.js` | 更新 SVG 倒塌与纸屑效果，手动开启后用 Web Audio 合成音效 |
| 工具链 | `scripts/`、`tests/` | esbuild 单文件构建、开发/预览服务器、Playwright 回归测试 |

## GitHub Pages 发布与校验

1. 在 GitHub 仓库配置发布源：**Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 推送到 `main` 分支或手动运行 **H5 Pages** 工作流（`pull_request` 仅执行验证，不上传产物也不部署；通过验证后仅将 `dist/` 以官方 OIDC 短期凭据部署，权限为工作流级 `contents: read` 与部署作业级 `pages: write`、`id-token: write`）：

```sh
git push origin main

# 或通过 GitHub CLI 手动触发并跟踪工作流
gh workflow run "H5 Pages"
gh run watch
```

3. 工作流会在上传 `dist` 前执行 `git diff --exit-code -- index.html` 与 `cmp -s index.html dist/index.html`。发布完成后，校验本地 `index.html` / `dist/index.html` 与线上页面 <https://himentpear.github.io/one-stroke-street/> 的 SHA-256 是否完全一致：

```sh
# Linux / Git Bash
sha256sum index.html dist/index.html
curl -fsSL https://himentpear.github.io/one-stroke-street/ | sha256sum

# macOS
shasum -a 256 index.html dist/index.html
curl -fsSL https://himentpear.github.io/one-stroke-street/ | shasum -a 256
```

```powershell
# Windows PowerShell
curl.exe -fsSL https://himentpear.github.io/one-stroke-street/ -o "$env:TEMP\pages-live.html"
Get-FileHash index.html, dist/index.html, "$env:TEMP\pages-live.html" -Algorithm SHA256
```

## 线上回滚命令

若上线后发现问题，在 `main` 回滚目标提交并重新推送即可触发同一条 **H5 Pages** 验证与发布流水线：

```sh
git log --oneline -n 5
git revert <commit-sha> --no-edit
git push origin main
```

原始交互草图保存在 `visuals/one-stroke-street.html`，美术与交付提示词保存在 `delivery-prompt.txt`。
