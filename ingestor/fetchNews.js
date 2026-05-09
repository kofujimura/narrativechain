import RSSParser from 'rss-parser'

const parser = new RSSParser()

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC Business', category: 'finance' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World', category: 'politics' },
  { url: 'https://www.ft.com/rss/home', source: 'Financial Times', category: 'finance' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera', category: 'politics' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR News', category: 'politics' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World', category: 'politics' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', source: 'NYT Business', category: 'finance' },
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
