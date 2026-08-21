import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

function app() {
  return createApp();
}

test("GET /health returns ok", async () => {
  const res = await request(app()).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("GET /api/articles returns seeded articles", async () => {
  const res = await request(app()).get("/api/articles");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length >= 3);
});

test("GET /api/articles filters by category", async () => {
  const res = await request(app()).get("/api/articles?category=science");
  assert.equal(res.status, 200);
  assert.ok(res.body.data.every((a) => a.category === "science"));
});

test("POST then GET creates and retrieves an article", async () => {
  const server = app();
  const created = await request(server).post("/api/articles").send({
    title: "Breaking: environment works end to end",
    body: "A newly created article proves the API round-trips correctly.",
    author: "QA Bot",
    category: "tech",
  });
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  const fetched = await request(server).get(`/api/articles/${id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.title, created.body.data.title);
});

test("POST validates required fields", async () => {
  const res = await request(app()).post("/api/articles").send({ title: "x" });
  assert.equal(res.status, 400);
});

test("GET missing article returns 404", async () => {
  const res = await request(app()).get("/api/articles/99999");
  assert.equal(res.status, 404);
});

test("PUT updates and DELETE removes an article", async () => {
  const server = app();
  const created = await request(server).post("/api/articles").send({
    title: "Temp",
    body: "temp body",
    author: "temp",
  });
  const id = created.body.data.id;

  const updated = await request(server)
    .put(`/api/articles/${id}`)
    .send({ title: "Updated title" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.title, "Updated title");

  const removed = await request(server).delete(`/api/articles/${id}`);
  assert.equal(removed.status, 204);

  const missing = await request(server).get(`/api/articles/${id}`);
  assert.equal(missing.status, 404);
});
