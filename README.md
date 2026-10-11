<a name="english"></a>
<p align="center"><b>English</b> · <a href="#zh">简体中文</a></p>

<p align="center"><img src="media/readme/hero.jpg" alt="Diem: Pip carries your handwritten page to Toto, who turns it into a beautiful day"></p>

<h3 align="center">Handwrite your day. Get a beautiful day back.</h3>


Diem is a Mac app for one day at a time: a paper for loose thoughts, a pond for the things you'll actually do, and a timeline. There is no AI inside the app. **The AI is the one you already use**: any AI agent that can read and write files on your Mac. It reads a photo of your handwritten page, plans your day, and writes you a daily review in the evening. Every change it makes comes with a note you can undo. [Claude Code](https://claude.com/claude-code) is the default and the most tested.

<p align="center"><img src="media/readme/ai-en.png" width="720" alt="Works with Claude, ChatGPT, Gemini, DeepSeek, Kimi, Qwen, GLM, MiniMax and Doubao"></p>

[**Download Diem for Mac**](https://github.com/daisycao/diem/releases/latest) · macOS 14+ · Apple silicon & Intel · MIT

![Diem: paper, pond, timeline](media/readme/app-en.png)

## How a day goes

**Morning: write it down.** Scribble on paper the way you always do: circle what matters, number things, draw arrows, write "2H" next to a task. Snap a photo and drop it on Diem. Tell your AI *"Import my paper"* and 🐿️ Pip turns it into a paper you can drag around. Or just type straight onto the paper in the app.

**Midday: make it real.** Drag a thought into the **pond** and it becomes a task. Drag a task onto the **timeline** and it's planned. Or say *"Toto, plan my day"* and 🐘 Toto proposes a plan with white space left in it; you see dashed outlines, then accept, pick, or say no. Turn on **Write to Calendar** and every block lands in a "Diem" calendar, so your iPhone shows it and reminds you.

**All day: just use the app.** Tick things off, drag them around, log what you did. No need to touch the paper again (though if you'd rather tick the sheet and snap it once more at night, Pip can read that too).

**Evening: look back.** Say *"Write my daily review"*. 🐘 Toto writes you a page that starts from your handwritten sheet: what got done, how the day went against the plan, where the time went, and what tomorrow looks like.

<p align="center"><img src="media/readme/review-en.png" width="560" alt="A daily review written by Toto, starting from the handwritten page"></p>

## Meet the crew

<p align="center"><img src="media/readme/crew.jpg" alt="Pip, Toto, Fetch and Zaza at the desk"></p>

They live in your AI. Whatever they touch, they sign.

| | | |
| --- | --- | --- |
| 🐿️ | **Pip** | *Picks up every scrap you drop.* Jots, paper imports, tidy-ups. |
| 🐘 | **Toto** | *Steady, and never forgets.* Plans your day, writes your daily review. |
| 🐶 | **Fetch** | *Sniffs out ideas — only when you call.* |
| 🐦 | **Zaza** | *Chirps when something needs you.* Due dates and nudges (Labs). |

## Why there's no AI inside

- **Your files, on your Mac.** Everything is plain JSON and Markdown in one folder (`~/Documents/Diem`). No account, no server, no API key.
- **Your AI does the thinking.** The folder comes with the rules (`CLAUDE.md`, plus `AGENTS.md` and `GEMINI.md` pointing to it) that teach any agent how Diem works. Open your AI there and talk to it.
- **Nothing changes behind your back.** Every AI change leaves a memo in the app: accept it, undo it all, or undo one line. Big changes (planning a day, tidying the paper) arrive as proposals and only happen when you say so.
- **The review learns.** Tell Toto "that's wrong" about a review and it writes the lesson to `review/lessons.md` and follows it next time.

## Get started

1. [Download](https://github.com/daisycao/diem/releases/latest) `Diem.dmg`, drag Diem to Applications, and open it.
   The app isn't notarized yet, so the first time macOS may refuse: right-click Diem → **Open** → **Open**, or go to System Settings → Privacy & Security → **Open Anyway**.
2. Diem creates `~/Documents/Diem` with a sample day in it. (Me → *Use another folder…* to pick a different one.)
3. Open your AI agent in that folder. With [Claude Code](https://claude.com/claude-code) (recommended):
   ```bash
   cd ~/Documents/Diem
   claude
   ```
Using another AI? See [Use any AI](#use-any-ai).
4. Try: *"Toto, plan my day"*. Then drop a photo of a handwritten page on the app and say *"Import my paper"*.

Any blank sheet of paper works. A pen in dark blue or black reads best.

**Jot from anywhere.** With Claude Code, add this line to your global `~/.claude/CLAUDE.md` and you can say "jot: …" in any session:
```
When I say "jot: …", run node ~/Documents/Diem/bin/jot.mjs "…"; for "add to pond: …" add --list.
```

## Use any AI

Diem only writes files; the AI does the other half. Any agent that can read and write files on your Mac works. Claude Code is the default because it follows the rules most reliably, and it can also run other companies' models.

- **Claude Code with another model.** If your provider offers an Anthropic-compatible API (DeepSeek, Kimi, Qwen, GLM, MiniMax and others do), point Claude Code at it. For DeepSeek:
  ```bash
  export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
  export ANTHROPIC_AUTH_TOKEN=<your DeepSeek API key>
  export ANTHROPIC_MODEL=deepseek-flash
  cd ~/Documents/Diem && claude
  ```
- **Another agent.** OpenAI's Codex CLI reads `AGENTS.md`, Google's Gemini CLI reads `GEMINI.md`; both point to the same `CLAUDE.md`. For others, start with *"Read CLAUDE.md and follow it."*
- **Reading photos** needs a model that can see images. Planning and reviews work with any.

How well it goes depends on the model: the rules ask it to never invent your estimates, never undo your words, and always leave a memo, and stronger models follow them better.

## Labs

All off by default, in Me → Labs:

- **One brain**: a Claude Code hook logs every step the AI takes in your Diem folder, and its guesses about you wait for your OK. To install the hook, add a `PostToolUse` hook to `~/.claude/settings.json` that runs `node ~/Documents/Diem/bin/sync-hook.mjs`.
- **Zaza**: Mac notifications for due dates and things you're waiting on.
- **Places**: Diem reads your Wi-Fi name to know if you're home or at the office, and floats up what you can do there.
- **Colors follow the almanac**: picks one of six ink colors from the day's Chinese stem-and-branch element. Just for a good mood.

## Build from source

```bash
git clone https://github.com/daisycao/diem.git
cd diem
./build.command        # or: zsh app/build-app.sh
```
Needs Xcode command line tools and Node 20+. The UI is TypeScript (`app/web/src`) in a small Swift shell (`app/native`). For browser debugging: `DIEM_WS=/some/copy node app/tools/dev-server.mjs` and add `?lang=en` or `?lang=zh`.

## Sister app

[**Anew**](https://github.com/daisycao/anew): read with AI in the margins. Notes attached to a block on your paper open in Anew if you have it.

---

*Carpe diem.* MIT License.

---

<a name="zh"></a>
<p align="center"><a href="#english">English</a> · <b>简体中文</b></p>

<h2 align="center">这一天 · Diem</h2>
<h3 align="center">手写你的一天，收回漂亮的一天。</h3>


「这一天」是一个 Mac 上的一日清单：一张随手写的纸、一个放「真要做的事」的池塘、一条时间轴。app 里没有 AI，**AI 就是你已经在用的那个**：任何能读写 Mac 上文件的 AI 都行。它认你拍的手写纸、帮你排今天、晚上给你写一篇日报。它改的每一处都有 memo，都能撤回。默认推荐 [Claude Code](https://claude.com/claude-code)，用得最多、最稳定。

<p align="center"><img src="media/readme/ai-zh.png" width="720" alt="支持 Claude、ChatGPT、Gemini、DeepSeek、Kimi、通义千问、智谱 GLM、MiniMax、豆包"></p>

[**下载 Mac 版**](https://github.com/daisycao/diem/releases/latest) · macOS 14+ · Apple 芯片和 Intel 都能用 · MIT

![这一天：纸、池塘、时间轴](media/readme/app-en.png)

## 一天怎么过

**早上：写下来。** 照你平时的习惯在纸上乱写：圈出要紧的、打编号、拉箭头，在事情后面写「2H」。拍一张拖进 app，跟你的 AI 说「导入这张纸」，🐿️ 拾拾就把它认成一张能拖的纸。也可以直接在 app 的纸上打字。

**白天：排上。** 把一个念头拖进**池塘**，它就成了一件事；再拖到**时间轴**上，就排上了。或者说「妥妥，帮我把今天排一下」，🐘 妥妥给你一份留了白的排法，先用虚线框给你看，你照做、逐条挑或者不要。打开「写进系统日历」，每一块都会写进「Diem」日历，iPhone 上能看到、到点提醒。

**白天：在电脑上就行。** 打勾、拖动、补记，都在 app 里，不用再碰那张纸（想在纸上打勾、晚上再拍一张也行，拾拾一样认得）。

**晚上：回头看。** 说「写今天的日报」，🐘 妥妥写一页日报，从你那张手写纸开始：做成了什么、和计划比怎么样、时间去哪了、明天怎么排。

<p align="center"><img src="media/readme/review-en.png" width="560" alt="妥妥写的日报，从那张手写纸开始"></p>

## 认识小伙伴

<p align="center"><img src="media/readme/crew.jpg" alt="拾拾、妥妥、闻闻、喳喳"></p>

它们住在你的 AI 里。动过你的东西，都会签上名字。

| | | |
| --- | --- | --- |
| 🐿️ | **拾拾 Pip** | 你掉下的每个念头，它都捡起来。记下来、导入纸、大整理。 |
| 🐘 | **妥妥 Toto** | 稳稳当当，什么都记得。排今天、写日报。 |
| 🐶 | **闻闻 Fetch** | 你叫它，它才去找灵感。 |
| 🐦 | **喳喳 Zaza** | 有事要你跟，它叫一声。快到期的、该催的（实验功能）。 |

## 为什么 app 里不接 AI

- **文件都在你的 Mac 上。** 所有东西都是一个文件夹里的 JSON 和 Markdown（`~/Documents/Diem`），不用注册、没有服务器、不要 API key。
- **想事情的是你的 AI。** 文件夹里自带规则（`CLAUDE.md`，还有指向它的 `AGENTS.md`、`GEMINI.md`），教各家 AI 怎么用这一天。在那里打开你的 AI 说话就行。
- **不会背着你改。** AI 每改一处，app 里都有一条 memo：接受、全部撤回、逐条撤回。大事（排一天、整理纸）先是提议，你点了才做。
- **日报会学。** 对日报说「这里不对」，妥妥会记进 `review/lessons.md`，下一篇照做。

## 开始用

1. [下载](https://github.com/daisycao/diem/releases/latest) `Diem.dmg`，把 Diem 拖进「应用程序」再打开。
   还没做公证，第一次 macOS 可能拦着：右键 Diem →「打开」→「打开」，或者去「系统设置 › 隐私与安全性」点「仍要打开」。
2. 这一天会建好 `~/Documents/Diem`，里面有一天的示例（「我的 → 换一个工作目录…」可以换）。
3. 在这个文件夹里打开你的 AI。用 [Claude Code](https://claude.com/claude-code)（推荐）：
   ```bash
   cd ~/Documents/Diem
   claude
   ```
用别家的 AI？看下面「用别的 AI」。
4. 试试说「妥妥，帮我把今天排一下」。再把一张手写纸的照片拖进 app，说「导入这张纸」。

**在哪都能记。** 用 Claude Code 的话，把这一行加进全局的 `~/.claude/CLAUDE.md`，在任何会话里说「记下来：……」都行：
```
我说「记下来：……」时，运行 node ~/Documents/Diem/bin/jot.mjs "……"；说「记到池塘里：……」时加 --list。
```

## 用别的 AI

这一天只写文件，另一半交给 AI。能读写 Mac 上文件的 AI 都能用。默认推荐 Claude Code，因为它最守规矩；它也能接别家的模型。

- **Claude Code 接别家模型**：DeepSeek、Kimi、通义千问、智谱 GLM、MiniMax 等都提供兼容 Anthropic 的接口。以 DeepSeek 为例：
  ```bash
  export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
  export ANTHROPIC_AUTH_TOKEN=<你的 DeepSeek API key>
  export ANTHROPIC_MODEL=deepseek-flash
  cd ~/Documents/Diem && claude
  ```
- **用别家的 AI 工具**：OpenAI 的 Codex CLI 读 `AGENTS.md`，Google 的 Gemini CLI 读 `GEMINI.md`，都指向同一份 `CLAUDE.md`。其他工具开头说一句「读 CLAUDE.md，照着做」。
- **认手写纸**要用能看图的模型；排程、写日报哪家都行。

效果看模型：规则要求它不替你估时长、不改你写的字、每次都留 memo，越强的模型越守得住。

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
