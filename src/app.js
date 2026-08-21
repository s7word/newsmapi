import express from "express";
import { createStore } from "./store.js";
import { articlesRouter } from "./routes/articles.js";

export function createApp({ store = createStore() } = {}) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/", (req, res) => {
    res.json({
      name: "newsmapi",
      description: "A minimal News REST API",
      endpoints: [
        "GET /health",
        "GET /api/articles",
        "GET /api/articles/:id",
        "POST /api/articles",
        "PUT /api/articles/:id",
        "DELETE /api/articles/:id",
      ],
    });
  });

  app.use("/api/articles", articlesRouter(store));

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
