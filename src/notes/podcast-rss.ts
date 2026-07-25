/**
 * podcast-rss.ts — podcast feed parsing (DESIGN §22, podcast medium). PURE —
 * golden-tested in golden/podcast.mjs against a real のらじお feed snippet.
 *
 * Standard RSS 2.0 as served by Anchor/Megaphone/robotstart: CDATA titles,
 * <enclosure url type="audio/*">, <itunes:duration> as HH:MM:SS or seconds.
 */

export interface PodcastEpisode {
  title: string;
  audioUrl: string;
  pubDate: string;
  durationSec: number | null;
  link?: string;
}

export interface PodcastFeed {
  show: string;
  episodes: PodcastEpisode[];
}

const cdata = (s: string): string =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();

const tag = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? cdata(m[1]) : '';
};

export function parseDuration(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parsePodcastFeed(xml: string): PodcastFeed {
  const show = tag(xml.split(/<item[\s>]/i)[0] ?? '', 'title') || 'Podcast';
  const episodes: PodcastEpisode[] = [];
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const item of items) {
    const enc = item.match(/<enclosure[^>]*\burl=["']([^"']+)["'][^>]*>/i);
    const type = item.match(/<enclosure[^>]*\btype=["']([^"']+)["'][^>]*>/i)?.[1] ?? '';
    if (!enc || (type && !type.startsWith('audio/'))) continue;
    const title = tag(item, 'title');
    if (!title) continue;
    episodes.push({
      title,
      audioUrl: enc[1].replace(/&amp;/g, '&'),
      pubDate: tag(item, 'pubDate'),
      durationSec: parseDuration(tag(item, 'itunes:duration')),
      link: tag(item, 'link') || undefined,
    });
  }
  return { show, episodes };
}

/** The podcast source note: frontmatter + audio embed; transcript lines are
 *  appended by the ⚙ whisper stage (marked generated, DESIGN §22.2). */
export function podcastNote(show: string, ep: PodcastEpisode, audioVaultPath: string): string {
  return [
    '---',
    'source: podcast',
    `show: "${show.replace(/"/g, "'")}"`,
    `title: "${ep.title.replace(/"/g, "'")}"`,
    ...(ep.link ? [`url: "${ep.link}"`] : []),
    `audio: "${audioVaultPath}"`,
    'generated: pending',
    '---',
    '',
    `# ${ep.title}`,
    '',
    `![[${audioVaultPath}]]`,
    '',
    '> [!info] ⚙ 書き起こし待ち — 「🎙 Podcast: whisperで書き起こし」コマンドで',
    '> タイムスタンプ付きトランスクリプトがここに入ります（生成マーク付き）。',
    '',
  ].join('\n');
}
