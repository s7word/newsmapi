import { seedArticles } from "./data/seed.js";

// Simple in-memory article store. It is intentionally dependency-free so the
// development environment runs end-to-end without any external database.
class ArticleStore {
  constructor(seed = []) {
    this.articles = new Map();
    this.nextId = 1;
    for (const article of seed) {
      this.create(article);
    }
  }

  list({ category } = {}) {
    let items = [...this.articles.values()];
    if (category) {
      items = items.filter(
        (a) => a.category.toLowerCase() === category.toLowerCase(),
      );
    }
    return items.sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    );
  }

  get(id) {
    return this.articles.get(Number(id)) ?? null;
  }

  create({ title, body, author, category = "general", publishedAt }) {
    const id = this.nextId++;
    const article = {
      id,
      title,
      body,
      author,
      category,
      publishedAt: publishedAt ?? new Date().toISOString(),
    };
    this.articles.set(id, article);
    return article;
  }

  update(id, patch) {
    const existing = this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, id: existing.id };
    this.articles.set(existing.id, updated);
    return updated;
  }

  remove(id) {
    return this.articles.delete(Number(id));
  }
}

export function createStore({ seed = seedArticles } = {}) {
  return new ArticleStore(seed);
}
