# Repository Guidelines

## Project Structure & Module Organization
This is a Vite-based Three.js application using ES modules. Core application files currently live at the repository root: `app.js`, `setup.js`, `scene.js`, `model.js`, and related scene/layout modules. Browser assets live under `public/assets/`. End-to-end tests live in `e2e/`, while unit/model tests use `*.test.js` files such as `model.test.js`.

Keep new features modular. Prefer focused files such as `persona-simulation.js`, `shopify-products.js`, or `house-layout.js` instead of expanding `app.js` indefinitely.

## Build, Test, and Development Commands
Use Node.js 22.12+.

```bash
npm ci
npm run dev
npm test
npm run test:e2e
npm run build
```

- `npm run dev` starts Vite locally.
- `npm test` runs Node model/unit tests.
- `npm run test:e2e` runs Playwright browser flows.
- `npm run build` creates the production bundle and must pass before merge.

## Coding Style & Naming Conventions
Use ES modules and match the existing JavaScript style. Use `camelCase` for variables/functions, `PascalCase` only for classes, and kebab-case filenames for feature modules. Keep geometry/state logic separate from rendering and DOM code. Reuse the existing room/scene state model instead of creating parallel sources of truth.

No formatter or linter is currently enforced, so keep changes small and stylistically consistent with neighboring code.

## Testing Guidelines
Add or update tests for behavior changes. Use `*.test.js` for Node tests and place user-flow coverage in `e2e/`. For 3D or layout changes, verify both deterministic state/model behavior and the browser flow when practical.

Before merging, run:

```bash
npm test && npm run test:e2e && npm run build
```

## Commit & Pull Request Guidelines
The repository currently has too little history to establish a commit convention. Use short imperative messages such as `feat: add persona simulation` or `fix: preserve locked furniture`.

PRs should describe the feature, affected files, verification performed, and include screenshots/video for visual changes.

## Agent & Parallel Development Rules
This is a two-person hackathon repository. Before every new task:

```bash
git status
git fetch origin
git switch main
git pull --ff-only origin main
git log --oneline -5
git switch -c feat/<feature-name>
```

Never develop directly on `main`. Each developer/Antigravity agent must work on a fresh feature branch created from the latest `main`. Before editing shared architecture, inspect current Git progress and existing interfaces first. Avoid modifying files actively owned by the other developer. Push, review, and merge completed work before starting the next dependent feature.
