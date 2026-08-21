# newsmapi

A minimal News REST API built with Node.js and Express.

## Requirements

- Node.js >= 20 (developed on Node 22)

## Setup

```bash
npm ci        # or: npm install
```

## Run

```bash
npm start     # starts the API on http://localhost:3000
npm run dev   # start with auto-reload (node --watch)
```

Set `PORT` / `HOST` env vars to override the default `0.0.0.0:3000`.

## Test & Lint

```bash
npm test      # runs the node:test suite
npm run lint  # runs eslint
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/` | Service info + endpoint list |
| GET | `/api/articles` | List articles (optional `?category=`) |
| GET | `/api/articles/:id` | Get a single article |
| POST | `/api/articles` | Create an article (`title`, `body`, `author` required) |
| PUT | `/api/articles/:id` | Update an article |
| DELETE | `/api/articles/:id` | Delete an article |

Articles are kept in an in-memory store seeded at startup, so no external
database is required for local development.

### Example

```bash
curl -s http://localhost:3000/api/articles | jq

curl -s -X POST http://localhost:3000/api/articles \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"World","author":"me","category":"tech"}'
```

## Cloud Agent environment

`.cursor/environment.json` installs dependencies with `npm ci` and runs the API
in a persistent `api-server` terminal via `npm start`, exposing port `3000`.
