import { filterTopArticles } from './importanceFilter.js'

// Empty selection is a successful no-op, never a fallback to the top raw article.
export async function analyzeEligibleArticles(articles, { generate, filter = filterTopArticles, topN = 1 }) {
  const selected = await filter(articles, topN)
  const results = []
  for (const article of selected) results.push({ article, result: await generate(article) })
  return results
}
