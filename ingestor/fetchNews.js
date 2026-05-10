import RSSParser from 'rss-parser'

const parser = new RSSParser()

const FEEDS = [
  { url: 'https://news.web.nhk/n-data/conf/na/rss/cat0.xml', source: 'NHK総合', category: 'politics' },
  { url: 'https://news.web.nhk/n-data/conf/na/rss/cat4.xml', source: 'NHK経済', category: 'finance' },
  { url: 'https://rss.asahi.com/rss/asahi/newsheadlines.rdf', source: '朝日新聞', category: 'politics' },
  { url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml', source: 'Yahoo!ニュース', category: 'politics' },
  { url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss', source: '毎日新聞', category: 'politics' },
]

const failureCooldown = new Map()
const COOLDOWN_MS = 5 * 60 * 1000

export async function fetchAllNews() {
  const articles = []
  const now = Date.now()

  for (const feed of FEEDS) {
    const lastFailure = failureCooldown.get(feed.url)
    if (lastFailure && now - lastFailure < COOLDOWN_MS) continue

    try {
      const result = await parser.parseURL(feed.url)
      const items = result.items.slice(0, 5).map(item => ({
        title: item.title?.trim(),
        body: item.contentSnippet?.slice(0, 500) || '',
        url: item.link,
        source: feed.source,
        category: feed.category,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      })).filter(a => a.title && a.url)

      articles.push(...items)
    } catch {
      failureCooldown.set(feed.url, now)
    }
  }

  return articles
}
