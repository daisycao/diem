// 电脑记录里「在做什么」：浏览器按网站算（x.com → X），其他按应用算。app 和 bin/day.mjs 共用。

const SITES: [RegExp, string][] = [
  [/^(x|twitter)\.com/, 'X'],
  [/xiaohongshu\.com/, 'Xiaohongshu'],
  [/(youtube\.com|youtu\.be)/, 'YouTube'],
  [/bilibili\.com/, 'Bilibili'],
  [/weibo\.com/, 'Weibo'],
  [/zhihu\.com/, 'Zhihu'],
  [/douyin\.com/, 'Douyin'],
  [/mp\.weixin\.qq\.com/, 'WeChat article'],
  [/github\.com/, 'GitHub'],
  [/reddit\.com/, 'Reddit'],
  [/news\.ycombinator\.com/, 'Hacker News'],
  [/linkedin\.com/, 'LinkedIn'],
  [/notion\.so/, 'Notion'],
  [/figma\.com/, 'Figma'],
  [/slack\.com/, 'Slack'],
  [/claude\.ai/, 'Claude'],
  [/chatgpt\.com/, 'ChatGPT'],
  [/(mail\.google\.com|outlook\.)/, 'Mail'],
  [/docs\.google\.com/, 'Google Docs'],
  [/feishu\.cn|larksuite\.com/, 'Lark'],
];

/** 网址 → 网站名 */
export function siteOf(url: string): string {
  const host = url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  for (const [re, name] of SITES) if (re.test(host)) return name;
  return host;
}

/** 一段记录算在谁头上：有网址按网站，没有按应用 */
export function whatOf(g: { app: string; url?: string }): string {
  return g.url ? siteOf(g.url) : g.app;
}
