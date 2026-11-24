# 一笔打烊

2D 纸板街区 H5 解谜游戏。用一笔划断卡扣或拆掉亮窗房，让巨型保龄球招牌撞穿街两边的四间店铺。[在线游玩](https://himentpear.github.io/one-stroke-street/)

## 从零运行

玩家可以直接打开仓库根目录的 `index.html`。开发环境使用 Git、Node.js 22.18.0、npm 11.7.0。使用系统安装器或本机已有的版本管理器安装 `.nvmrc` 指定的 Node 版本，npm 版本记录在 `package.json`。

```sh
git clone https://github.com/himentpear/one-stroke-street.git
cd one-stroke-street
node --version
npm install --global npm@11.7.0
npm ci
npm run setup:browsers
npm run dev
```

本地开发地址为 <http://127.0.0.1:5173/>。刷新页面会重新读取源码。要在同一 Wi-Fi 的手机上联调，运行 `npm run dev -- --host 0.0.0.0`，在手机浏览器打开电脑的局域网 IP 和端口 5173。Linux 首次安装测试浏览器时使用 `npx playwright install --with-deps chromium webkit`。

## 游戏架构

| 层 | 入口 | 职责 |
| --- | --- | --- |
| 页面与美术 | `src/page.html`、`style.css`、`scene.svg` | 响应式界面、四种基色、可重复使用的纸板部件、手机触控区域 |
| 关卡与命中 | `src/level.js` | 600 × 328 逻辑场景、四间房、两枚扣、弹板、144 单位笔长、线段与房间/扣子的相交判定 |
| 物理 | `src/physics.js` | 维护单局状态，每 1/120 秒推进翻转、滚动、重力、碰撞。发出房间碎裂、起跳和落地事件 |
| 输入与回合 | `src/game.js` | 将屏幕指针换算为场景坐标，处理落笔、指针取消、重画和结算。键盘和触屏复用同一套判定 |
| 画面与声音 | `src/view.js`、`audio.js` | 用 SVG 更新楼块与轨迹，用 Web Audio 合成撞击声。碎屑仅参与显示 |
| 工具链 | `scripts/`、`tests/` | esbuild 打包，Node 提供本地开发和产物预览，Playwright 验收浏览器行为 |

回合从待落笔进入倒塌，场面停稳后结算。划空保留笔数。重画会取消当前动画并创建新回合。开启系统“减少动态效果”时，仍使用相同的物理步计算终局。游戏和音效均在浏览器执行，音效由玩家手动开启。

## 构建与测试

```sh
npm test
npm run preview
```

`npm test` 先构建，再跑桌面 Chromium、360 像素 Android Chromium 和 iPhone 尺寸 WebKit 的浏览器测试。覆盖三种卡扣结果、空划、长度上限、中途重画、键盘、触摸取消、项目子路径和离线文件。设备配置属于浏览器模拟。单独构建用 `npm run build`，产物预览为 <http://127.0.0.1:4173/>。

构建器将 CSS、SVG 和打包后的经典脚本嵌入 HTML。根目录 `index.html` 用于直接打开，`dist/index.html` 用于发布，两者字节相同。修改 `src/` 后重新构建并提交根目录成品。

## GitHub Pages 发布

发布源选择仓库 **Settings → Pages → Build and deployment → GitHub Actions**。新仓库启用 Pages 后，提交到 `main` 或在 Actions 页面手动运行 **H5 Pages**。

1. 验证作业按锁文件安装工具，安装 Chromium 和 WebKit，重新构建并执行浏览器测试，同时核对根目录成品与源码匹配。
2. 验证通过后，只将 `dist/` 上传为 Pages 产物。发布作业通过 GitHub 提供的短期凭据部署，权限为 `pages: write` 和 `id-token: write`。
3. 在 Actions 的 `github-pages` 环境查看发布地址。拉取请求只做验证。回滚时在 `main` 提交对应发布的 revert，走同一条流水线。

原始交互草图保存在 `visuals/one-stroke-street.html`，美术和交付提示词保存在 `delivery-prompt.txt`。
