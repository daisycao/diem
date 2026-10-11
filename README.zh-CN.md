<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="media/brand/diem-logo-horizontal-white.svg">
    <img src="media/brand/diem-logo-horizontal-green.svg" width="320" alt="这一天 · Diem">
  </picture>
</p>

<!-- 首图：media/readme/hero.png，画好后放这里 -->

<h3 align="center">手写你的一天，收回漂亮的一天。</h3>


「这一天」是一个 Mac 上的一日清单：一张随手写的纸、一个放「真要做的事」的池塘、一条时间轴。app 里没有 AI，**AI 就是你的 [Claude Code](https://claude.com/claude-code)**：它认你拍的手写纸、帮你排今天、晚上给你写一篇日报。它改的每一处都有 memo，都能撤回。

[**下载 Mac 版**](https://github.com/daisycao/diem/releases/latest) · macOS 14+ · Apple 芯片和 Intel 都能用 · MIT

![这一天：纸、池塘、时间轴](media/readme/app-en.png)

## 一天怎么过

**早上：写下来。** 照你平时的习惯在纸上乱写：圈出要紧的、打编号、拉箭头，在事情后面写「2H」。拍一张拖进 app，在 Claude Code 里说「导入这张纸」，🐿️ 拾拾就把它认成一张能拖的纸。也可以直接在 app 的纸上打字。

**白天：排上。** 把一个念头拖进**池塘**，它就成了一件事；再拖到**时间轴**上，就排上了。或者说「妥妥，帮我把今天排一下」，🐘 妥妥给你一份留了白的排法，先用虚线框给你看，你照做、逐条挑或者不要。打开「写进系统日历」，每一块都会写进「Diem」日历，iPhone 上能看到、到点提醒。

**白天：在电脑上就行。** 打勾、拖动、补记，都在 app 里，不用再碰那张纸（想在纸上打勾、晚上再拍一张也行，拾拾一样认得）。

**晚上：回头看。** 说「写今天的日报」，🐘 妥妥写一页日报，从你那张手写纸开始：做成了什么、和计划比怎么样、时间去哪了、明天怎么排。

<p align="center"><img src="media/readme/review-en.png" width="560" alt="妥妥写的日报，从那张手写纸开始"></p>

## 认识小伙伴

<!-- 合影：media/readme/crew.png，画好后放这里 -->

它们住在 Claude Code 里。动过你的东西，都会签上名字。

| | | |
| --- | --- | --- |
| 🐿️ | **拾拾 Pip** | 你掉下的每个念头，它都捡起来。记下来、导入纸、大整理。 |
| 🐘 | **妥妥 Toto** | 稳稳当当，什么都记得。排今天、写日报。 |
| 🐶 | **闻闻 Fetch** | 你叫它，它才去找灵感。 |
| 🐦 | **喳喳 Zaza** | 有事要你跟，它叫一声。快到期的、该催的（实验功能）。 |

## 为什么 app 里不接 AI

- **文件都在你的 Mac 上。** 所有东西都是一个文件夹里的 JSON 和 Markdown（`~/Documents/Diem`），不用注册、没有服务器、不要 API key。
- **想事情的是 Claude Code。** 文件夹里自带一份 `CLAUDE.md`，教 Claude Code 怎么用这一天。在那里打开 Claude Code 说话就行。
- **不会背着你改。** AI 每改一处，app 里都有一条 memo：接受、全部撤回、逐条撤回。大事（排一天、整理纸）先是提议，你点了才做。
- **日报会学。** 对日报说「这里不对」，妥妥会记进 `review/lessons.md`，下一篇照做。

## 开始用

1. [下载](https://github.com/daisycao/diem/releases/latest) `Diem.dmg`，把 Diem 拖进「应用程序」再打开。
   还没做公证，第一次 macOS 可能拦着：右键 Diem →「打开」→「打开」，或者去「系统设置 › 隐私与安全性」点「仍要打开」。
2. 这一天会建好 `~/Documents/Diem`，里面有一天的示例（「我的 → 换一个工作目录…」可以换）。
3. 装好 [Claude Code](https://claude.com/claude-code)，然后：
   ```bash
   cd ~/Documents/Diem
   claude
   ```
4. 试试说「妥妥，帮我把今天排一下」。再把一张手写纸的照片拖进 app，说「导入这张纸」。

**在哪都能记。** 把这一行加进全局的 `~/.claude/CLAUDE.md`，在任何 Claude Code 会话里说「记下来：……」都行：
```
我说「记下来：……」时，运行 node ~/Documents/Diem/bin/jot.mjs "……"；说「记到池塘里：……」时加 --list。
```

## 实验功能

默认都关着，在「我的 → 实验功能」里：

- **一个大脑**：Claude Code 的 hook 记下 AI 在工作目录里的每一步，它对你的推测要你认可。装 hook：在 `~/.claude/settings.json` 里加一个 `PostToolUse` hook，运行 `node ~/Documents/Diem/bin/sync-hook.mjs`。
- **喳喳**：截止日、在等别人的事，发 Mac 通知。
- **地点**：读 Wi-Fi 名字判断你在家还是在办公室，那里能做的事浮上来。
- **配色跟着流日**：按当天干支五行，从六套墨色里挑一套，图个好心情。

## 从源码编译

```bash
git clone https://github.com/daisycao/diem.git
cd diem
./build.command
```
需要 Xcode 命令行工具和 Node 20+。界面是 TypeScript（`app/web/src`），外面一层很薄的 Swift（`app/native`）。

## 姊妹 app

[**知新 Anew**](https://github.com/daisycao/anew)：和 Claude 在页边一起读。纸上挂着的笔记，装了 Anew 就在 Anew 里打开。

---

*Carpe diem.* MIT License.
