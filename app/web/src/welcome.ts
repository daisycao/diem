// 第一次打开的引导，和「认识小伙伴」。
// First-run walkthrough, and "Meet the crew".
import { L } from './i18n';
import { S, saveUI } from './store';
import { ANIMALS } from './types';
import { h } from './util';

function modal(...kids: (Node | string | null)[]) {
  const box = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === box) box.remove(); } }, h('div', { class: 'modal' }, ...kids));
  document.body.append(box);
  return box;
}

const STEPS: [string, string, string, string, string][] = [
  ['✍️', '纸上随手写', 'Scribble on the paper', '点空白处直接写；圈、编号、箭头都行。也可以把手写的纸拍下来拖进窗口。', 'Click anywhere and write. Circle, number, draw arrows. Or drop a photo of a handwritten page onto the window.'],
  ['🪷', '丢进池塘', 'Drop it in the pond', '想做的事拖到中间的池塘里，它就成了一件事：可以写多久、截止日。', 'Drag a thought into the pond in the middle and it becomes a task, with a time estimate and a due date if you like.'],
  ['🕘', '拖上时间轴', 'Put it on the timeline', '拖到右边的时间轴就排上了。打开「我的 → 写进系统日历」，iPhone 上也能看到。', 'Drag it to the timeline on the right. Turn on Me → Calendar and it shows up on your iPhone too.'],
  ['🐘', '剩下的交给 AI', 'Hand the rest to your AI', '在工作目录里打开你的 AI（推荐 Claude Code，别家能改文件的 AI 也行），说「妥妥，帮我把今天排一下」「写今天的日报」。AI 改了什么都有 memo，能撤回。', 'Open your AI in your Diem folder (Claude Code recommended; any AI that can edit files works) and say "Toto, plan my day" or "Write my daily review". Every AI change comes with a memo you can undo.'],
];

export function showOnboarding() {
  let i = 0;
  const body = h('div', { class: 'onboard' });
  const draw = () => {
    const [icon, zh, en, dzh, den] = STEPS[i];
    body.replaceChildren(
      h('div', { class: 'modal-face' }, icon),
      h('div', { class: 'onboard-step' }, `${i + 1} / ${STEPS.length}`),
      h('h3', null, L(zh, en)),
      h('p', null, L(dzh, den)),
      h('div', { class: 'modal-row' },
        i > 0 ? h('button', { class: 'pill', type: 'button', onclick: () => { i--; draw(); } }, L('上一步', 'Back')) : null,
        h('button', {
          class: 'pill primary', type: 'button',
          onclick: () => { if (i < STEPS.length - 1) { i++; draw(); } else { box.remove(); showCrew(); } },
        }, i < STEPS.length - 1 ? L('下一步', 'Next') : L('认识小伙伴', 'Meet the crew'))),
    );
  };
  const box = modal(body);
  draw();
  S.ui.onboarded = true;
  saveUI();
}

export function maybeOnboard() {
  if (!S.ui.onboarded) showOnboarding();
}

export function showCrew() {
  const crew = (['拾拾', '妥妥', '闻闻', '喳喳'] as const).map(k => {
    const a = ANIMALS[k];
    return h('div', { class: 'crew-one' },
      h('div', { class: 'crew-face' }, a.emoji),
      h('div', null,
        h('b', null, L(a.zh, a.en)), ' ', h('span', { class: 'crew-job' }, L(a.zh === '拾拾' ? '收：记下来、导入纸、大整理' : a.zh === '妥妥' ? '排：排今天、写日报' : a.zh === '闻闻' ? '找：你叫它才去找' : '跟：快到期的、该催的（实验功能）',
          a.zh === '拾拾' ? 'gathers: jots, paper imports, tidy-ups' : a.zh === '妥妥' ? 'plans: your day, your daily review' : a.zh === '闻闻' ? 'fetches: only when you ask' : 'follows up: due dates and nudges (Labs)')),
        h('div', { class: 'crew-line' }, L(a.line, a.lineEn))));
  });
  const box = modal(
    h('h3', null, L('认识小伙伴', 'Meet the crew')),
    h('p', { class: 'muted' }, L('它们住在你的 AI 里。动过你的东西，都会签上名字。', 'They live in your AI. Whatever they touch, they sign.')),
    h('div', { class: 'crew' }, ...crew),
    h('div', { class: 'modal-row' }, h('button', { class: 'pill primary', type: 'button', onclick: () => box.remove() }, L('好', 'Nice to meet you'))),
  );
}
