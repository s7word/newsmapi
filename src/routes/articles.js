import { Router } from "express";

export function articlesRouter(store) {
  const router = Router();

  router.get("/", (req, res) => {
    const { category } = req.query;
    res.json({ data: store.list({ category }) });
  });

  router.get("/:id", (req, res) => {
    const article = store.get(req.params.id);
    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }
    res.json({ data: article });
  });

  router.post("/", (req, res) => {
    const { title, body, author, category, publishedAt } = req.body ?? {};
    if (!title || !body || !author) {
      return res
        .status(400)
        .json({ error: "title, body and author are required" });
    }
    const article = store.create({ title, body, author, category, publishedAt });
    res.status(201).json({ data: article });
  });

  router.put("/:id", (req, res) => {
    const patch = req.body ?? {};
    const updated = store.update(req.params.id, patch);
    if (!updated) {
      return res.status(404).json({ error: "Article not found" });
    }
    res.json({ data: updated });
  });

  router.delete("/:id", (req, res) => {
    const removed = store.remove(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: "Article not found" });
    }
    res.status(204).end();
  });

  return router;
}
