# Repository Guidelines

## 1. Purpose of This Repository

Living Blueprint is a two-person project for the Gemini 4 NYC Hackathon.

The product goal is to build a **Household Digital Twin**:

1. Create a 3D representation of an entire home, not just one room.
2. Represent fixed geometry such as walls, doors, windows, bathrooms, kitchens, and immovable fixtures.
3. Allow movable furniture to be repositioned, rotated, locked, or replaced.
4. Create household member personas and daily schedules.
5. Simulate how household members move and live inside the home.
6. Detect real spatial problems such as:
   - blocked paths,
   - collisions,
   - congestion,
   - poor TV visibility,
   - privacy issues,
   - WFH noise conflicts,
   - sunlight/glare issues,
   - emergency evacuation problems.
7. Use Gemini 4 to reason about the simulation results and propose layout improvements.
8. Use live Shopify product data for recommended furniture/products.
9. Convert selected products into usable 3D assets when possible.
10. Re-run the simulation after a redesign and show measurable before/after improvements.
11. Let the user proceed toward real Shopify checkout.

The core product loop is:

```text
Build Home
    ↓
Create Household Personas
    ↓
Design / Furnish
    ↓
Simulate Life
    ↓
Detect Problems
    ↓
Gemini Proposes Changes
    ↓
Apply ScenePatch
    ↓
Re-run Simulation
    ↓
Before / After
    ↓
Shopify Purchase Flow
```

The project must prioritize a working live demo over architectural perfection.

---

## 2. Team Ownership

This is a **two-person parallel-development repository**.

The two primary workstreams must remain as independent as possible.

### Kevin — Spatial Twin & Simulation

Kevin owns the physical world and deterministic validation layer.

Primary responsibilities:

- Whole-home 3D scene generation.
- Floorplan-to-scene conversion.
- Walls, floors, ceilings, doors, windows.
- Bathrooms, kitchens, AC units, and other fixed fixtures.
- Object locking / unlocking.
- 3D object movement and rotation.
- First-person WASD navigation.
- Orbit / overview camera.
- Scene selection and region selection.
- Household avatar rendering.
- Pathfinding.
- Collision detection.
- Congestion detection.
- Visibility and privacy checks.
- Noise approximation.
- Sunlight / glare checks.
- Guest stress tests.
- Fire evacuation simulation.
- Deterministic scene validators.
- Before/after simulation metrics.

Kevin should primarily work in files/directories related to:

```text
src/spatial/**
src/simulation/**
src/components/scene/**
src/components/avatar/**
src/lib/pathfinding/**
src/lib/validators/**
```

If the current repository structure does not yet contain these directories, create them gradually while preserving compatibility with the existing root-level modules.

Do not reorganize the entire repository unless explicitly required.

---

### Hank Lin — Gemini, Persona & Commerce

Hank owns AI reasoning, persona generation, product discovery, product metadata, and commerce integration.

Primary responsibilities:

- Gemini 4 / Antigravity agent workflows.
- Household persona creation.
- Persona preferences and dislikes.
- Daily schedules and activities.
- Household relationship constraints.
- Design reasoning.
- Redesign reasoning.
- Live Shopify product search.
- Product alternatives.
- Product price / variant / availability metadata.
- Product image / media → realistic 3D asset pipeline.
- Environment context:
  - time,
  - weather,
  - humidity,
  - wind,
  - sun direction.
- Translating deterministic simulation findings into human-readable persona complaints.
- Generating `ScenePatch` proposals.
- Shopify cart / checkout flow.

Hank should primarily work in:

```text
src/agents/**
src/persona/**
src/shopify/**
src/environment/**
src/components/catalog/**
src/components/persona/**
```

Again, create these directories only as needed.

Do not rewrite Kevin's rendering or simulation internals.

---

## 3. Shared Architecture

The most important rule is:

> **Coordinate through contracts, not by reaching into the other developer's implementation.**

Shared contracts should live in a small, clearly owned area such as:

```text
src/contracts/
  scene.js
  persona.js
  product.js
  simulation.js
  agent.js
```

If the repository remains plain JavaScript, these contracts may be JSDoc typedefs, exported schemas, validators, or structured examples.

Avoid introducing TypeScript only for the sake of contracts unless both developers agree and the migration is safe.

---

## 4. Core Shared Data Contracts

### Scene

The `Scene` is the single source of truth for the home.

Example conceptual structure:

```js
{
  houseId: "demo-house",
  rooms: [],
  walls: [],
  doors: [],
  windows: [],
  objects: [],
  environment: {}
}
```

Use:

- meters for world dimensions,
- Y as vertical,
- X/Z as the floor plane.

Do not mix centimeters, pixels, feet, and meters internally.

Convert user-facing units at the boundary.

---

### SceneObject

Each scene object should conceptually contain:

```js
{
  id: "chair-001",
  type: "shopify", // fixed | existing | shopify
  position: [1.2, 0, 3.4],
  rotation: [0, 1.57, 0],
  dimensions: {
    width: 0.8,
    height: 1.0,
    depth: 0.9
  },
  locked: false,
  modelUrl: "...",
  product: {}
}
```

`locked: true` means Gemini and automatic redesign logic must not move, rotate, remove, or replace the object.

Examples of likely locked objects:

- walls,
- toilets,
- sinks,
- kitchen counters,
- AC units,
- built-in appliances,
- sentimental furniture explicitly locked by the user.

---

### Persona

A persona should be structured data, not only prose.

Example:

```js
{
  id: "kevin",
  name: "Kevin",
  ageGroup: "adult",
  preferences: ["quiet workspace", "large TV"],
  dislikes: ["glare", "clutter"],
  schedule: [],
  needs: {
    privacy: 0.8,
    quiet: 0.9,
    accessibility: 0.3,
    daylight: 0.7,
    social: 0.6
  }
}
```

Gemini may generate this object, but application code must validate the shape before using it.

---

### ScenePatch

Gemini must not directly replace the entire scene.

Gemini should propose changes through a controlled `ScenePatch`.

Example:

```js
{
  reasoning: "Move the desk away from afternoon glare and replace the chair with a narrower model.",
  operations: [
    {
      type: "move",
      objectId: "desk-1",
      position: [4.0, 0, 2.2]
    },
    {
      type: "replace",
      objectId: "chair-1",
      productId: "shopify-product-id"
    }
  ]
}
```

Allowed operation types may include:

```text
move
rotate
add
remove
replace
lock
unlock
```

The application must reject invalid operations, especially operations on locked objects.

---

### SimulationFinding

Simulation results should be deterministic structured evidence.

Example:

```js
{
  type: "CONGESTION",
  location: "kitchen",
  severity: 0.82,
  evidence: {
    agents: 4,
    minimumClearanceMeters: 0.48,
    durationSeconds: 420
  }
}
```

Gemini may explain this result in natural language, but Gemini must not invent the underlying measurement.

---

## 5. Architectural Principle: Gemini Reasons, Validators Decide

The project should separate:

### Gemini responsibilities

Gemini may:

- interpret floorplan semantics,
- generate personas,
- generate schedules,
- infer style preferences,
- choose candidate Shopify products,
- propose layout changes,
- explain why a persona is dissatisfied,
- propose a redesign,
- generate a `ScenePatch`.

### Deterministic responsibilities

Application code should decide:

- whether objects collide,
- whether a path exists,
- minimum walkway clearance,
- whether a TV is visible,
- whether a privacy line-of-sight exists,
- approximate noise propagation,
- whether sunlight intersects a workspace,
- evacuation path length,
- whether a locked object was modified,
- whether a budget limit is exceeded,
- whether required Shopify product metadata is present.

A Gemini response must never be treated as proof that a redesign works.

The correct loop is:

```text
Gemini proposes
    ↓
Application applies patch
    ↓
Simulation runs
    ↓
Validators measure
    ↓
PASS / FAIL
    ↓
Gemini may try again
```

---

## 6. Current Project Structure

The repository currently uses Vite, Three.js, and JavaScript ES modules.

Existing core files include root-level application modules such as:

```text
app.js
setup.js
scene.js
model.js
```

Browser/static assets live under:

```text
public/assets/
```

Tests include:

```text
*.test.js
e2e/
```

Do not grow `app.js` into a giant file.

When adding significant behavior, prefer dedicated modules such as:

```text
persona-simulation.js
life-simulation.js
scene-patch.js
shopify-products.js
environment-context.js
pathfinding.js
visibility-validator.js
noise-validator.js
```

Keep:

- state/model logic,
- rendering,
- Gemini calls,
- Shopify calls,
- simulation,
- validation

as separate concerns.

---

## 7. Development Commands

Use the Node.js version required by the repository. Node.js 22.12+ is preferred if compatible with the current environment.

Install:

```bash
npm ci
```

Start local development:

```bash
npm run dev
```

Run unit/model tests:

```bash
npm test
```

Run browser/E2E tests:

```bash
npm run test:e2e
```

Build production bundle:

```bash
npm run build
```

Before a feature is considered ready to merge, run:

```bash
npm test
npm run test:e2e
npm run build
```

If one command is currently unavailable or broken for repository reasons, document that clearly in the branch summary instead of silently skipping it.

---

## 8. Coding Style

Use the existing JavaScript style unless the repository intentionally adopts another convention.

General rules:

- ES modules only.
- Prefer small modules over giant files.
- Use `camelCase` for variables and functions.
- Use `PascalCase` for classes.
- Use kebab-case file names for feature modules.
- Use descriptive names.
- Avoid hidden global mutable state.
- Do not create duplicate scene state stores.
- Keep world dimensions in meters.
- Keep Gemini output validation explicit.
- Keep external API calls behind dedicated adapters.

Examples:

Good:

```js
calculatePathClearance(...)
applyScenePatch(...)
validateLockedObjects(...)
searchShopifyProducts(...)
```

Avoid:

```js
doStuff(...)
handleEverything(...)
fixScene(...)
```

---

## 9. Git Workflow — Mandatory

Because two people and multiple Antigravity agents may work at the same time, Git discipline is mandatory.

### Before starting EVERY new feature

Run:

```bash
git status
git fetch origin
git switch main
git pull --ff-only origin main
git log --oneline -5
git status
```

Confirm:

1. You are on `main`.
2. `main` matches the latest remote state.
3. The working tree is clean.
4. You have read the latest commits.
5. No teammate has already implemented the same requirement.

Then create a NEW branch:

```bash
git switch -c feat/<feature-name>
```

Examples:

Kevin:

```text
feat/whole-home-scene
feat/scene-editor
feat/life-simulation
feat/stress-tests
feat/visibility-validator
```

Hank:

```text
feat/persona-agent
feat/shopify-live-search
feat/product-3d
feat/design-agent
feat/shopify-checkout
```

Do not keep one long-lived `kevin` or `hank` branch for the whole hackathon.

Use one branch per feature.

---

## 10. Before Asking Antigravity / Gemini to Implement Anything

Every implementation request must first instruct the agent to inspect repository state.

Use the following prompt prefix.

### Standard Antigravity Prompt Prefix

```text
You are working in a two-person Gemini hackathon repository with parallel development.

Before editing any file:

1. Run `git status`.
2. Report the current branch.
3. Run `git fetch origin`.
4. Inspect the latest `origin/main` commits with `git log --oneline origin/main -8`.
5. Confirm whether the current branch was created from the latest `main`.
6. Inspect the existing repository structure before proposing changes.
7. Read the relevant existing modules and any files under `src/contracts/` if present.
8. Identify which workstream owns this feature:
   - Kevin: spatial / simulation / validators / 3D scene
   - Hank: Gemini / personas / Shopify / environment / commerce
9. Do not modify files owned by the other workstream unless the task cannot be completed otherwise.
10. If shared contracts must change, explain the proposed change before making broad architectural edits.

Do not directly modify `main`.
Do not merge branches automatically.
Do not rewrite unrelated code.
Do not perform broad cleanup or refactoring unless explicitly requested.

After inspecting the repository, implement the requested feature on the current feature branch.
```

Always append the specific feature request after this prefix.

---

## 11. Prompt Template — Kevin Feature

Use this when assigning a spatial/simulation feature to Gemini or Antigravity.

```text
[Include the Standard Antigravity Prompt Prefix first.]

TASK OWNER: Kevin
WORKSTREAM: Spatial Twin / Simulation

Feature:
<describe the exact feature>

Goal:
<describe what should visibly work when finished>

Requirements:
- Preserve the existing Scene as the source of truth.
- Use meters for geometry.
- Do not place Gemini reasoning inside deterministic simulation code.
- Keep rendering separate from model/state logic.
- Respect locked scene objects.
- Reuse existing scene/model utilities where possible.
- Add deterministic validation for the feature where practical.
- Do not modify Hank-owned Gemini/Shopify/persona modules unless a shared interface is required.

Expected verification:
1. Explain how to manually test the feature.
2. Add/update unit tests where deterministic logic exists.
3. Add/update Playwright coverage if this changes a user-visible flow.
4. Run `npm test`.
5. Run `npm run test:e2e`.
6. Run `npm run build`.

At completion provide:
- summary,
- files changed,
- any shared contract changes,
- tests run and results,
- remaining limitations,
- exact integration notes for Hank.
```

---

## 12. Prompt Template — Hank Feature

Use this when assigning an AI/persona/commerce feature.

```text
[Include the Standard Antigravity Prompt Prefix first.]

TASK OWNER: Hank Lin
WORKSTREAM: Gemini / Persona / Shopify / Commerce

Feature:
<describe the exact feature>

Goal:
<describe what should visibly work when finished>

Requirements:
- Gemini must return structured data where application code depends on the result.
- Validate Gemini output before applying it.
- Gemini must propose scene changes through ScenePatch rather than directly replacing the scene.
- Do not bypass locked objects.
- Shopify product results must come from live supported Shopify data, not invented metadata.
- Keep Shopify/API logic behind adapters.
- Keep product candidates separate from currently selected scene products.
- Keep deterministic facts such as price, availability, geometry, and validator outcomes separate from AI-generated explanation.
- Do not modify Kevin-owned simulation/rendering internals unless a shared contract is required.

Expected verification:
1. Demonstrate the API/agent flow with a concrete example.
2. Verify structured output.
3. Verify failure handling when Gemini/API output is missing or invalid.
4. Run `npm test`.
5. Run `npm run test:e2e`.
6. Run `npm run build`.

At completion provide:
- summary,
- files changed,
- external API assumptions,
- any environment variables required,
- any shared contract changes,
- tests run and results,
- exact integration notes for Kevin.
```

---

## 13. Prompt Template — Integration Task

Use this only when merging both tracks into one visible feature.

```text
You are integrating two parallel hackathon workstreams.

Before editing:
- inspect current Git status,
- update from latest main,
- review recent commits from both Kevin and Hank,
- identify the current Scene / ScenePatch / Persona / SimulationFinding interfaces,
- do not redesign either workstream unless necessary.

Integration goal:
<describe the full end-to-end flow>

Required pipeline:

Scene
→ Persona / Schedule
→ Gemini reasoning
→ Shopify candidate products
→ ScenePatch
→ Spatial engine applies patch
→ Simulation
→ Deterministic findings
→ Gemini explanation/redesign
→ Replay
→ Before/after result

Rules:
- resolve integration problems at contract boundaries first,
- do not duplicate state,
- do not let Gemini override deterministic validator results,
- preserve locked objects,
- preserve live Shopify product references,
- avoid unrelated UI redesign.

Verification:
- run the full demo flow from a clean page load,
- run tests,
- run production build,
- report exactly where failures remain.

Do not merge automatically.
```

---

## 14. Commit Guidelines

Use short, explicit commit messages.

Examples:

```text
feat: add whole-home scene renderer
feat: add persona schedule generation
feat: add Shopify live product search
feat: add household pathfinding
feat: add fire evacuation stress test
fix: preserve locked furniture during scene patch
fix: prevent duplicate scene objects after redesign
test: add collision validator coverage
```

Avoid meaningless commit messages such as:

```text
update
fix stuff
final
changes
wip2
```

---

## 15. Pull Request / Merge Checklist

Before asking the teammate to merge:

```bash
git status
npm test
npm run test:e2e
npm run build
```

Then commit and push:

```bash
git add .
git commit -m "feat: <description>"
git push -u origin feat/<feature-name>
```

The branch summary / PR should include:

1. What was implemented.
2. Which files changed.
3. How to test it.
4. Screenshots/video if visual.
5. Any new environment variables.
6. Any shared contract changes.
7. Known limitations.
8. Any integration action required from the teammate.

Do not merge a branch merely because the code compiles.

The feature should work in the intended demo path.

---

## 16. After Another Branch Is Merged

If you are still working on a separate feature and `main` changes:

```bash
git fetch origin
git merge origin/main
```

For this hackathon, prefer a simple merge over an aggressive rebase if there is any risk of losing work.

Resolve conflicts carefully.

After resolving:

```bash
npm test
npm run test:e2e
npm run build
```

Then continue development.

---

## 17. Parallel Agent Rules

Antigravity may support multiple autonomous agents, but do not let multiple coding agents edit the same feature branch simultaneously.

Allowed:

```text
Agent A: implementation
Agent B: read-only review
Agent C: test analysis
```

Avoid:

```text
Agent A: edits scene.js
Agent B: edits scene.js
Agent C: refactors scene.js
```

at the same time.

If multiple agents are used, assign explicit file ownership.

---

## 18. Simulation Priorities

The simulation layer should prioritize measurable behavior.

Suggested order:

### Priority 1
- path existence,
- collision,
- object clearance,
- congestion.

### Priority 2
- TV / object visibility,
- privacy sightlines.

### Priority 3
- noise approximation,
- sunlight/glare.

### Priority 4
- stress tests:
  - guests,
  - fire evacuation,
  - future household scenarios.

Do not attempt high-fidelity physics if a simpler deterministic model produces a reliable demo.

---

## 19. Persona Simulation Rules

Personas should influence behavior, not only UI text.

A persona may affect:

- destination choices,
- schedule timing,
- preferred rooms,
- tolerance for noise,
- privacy needs,
- accessibility requirements,
- lighting preferences,
- social behavior.

Example:

```text
Kevin:
09:00–17:00 WFH
high quiet requirement

Hank:
18:00–22:00 living room / TV
high social preference
```

The simulation may detect a conflict if the TV noise overlaps the WFH schedule.

The complaint shown to the user should derive from measured evidence.

---

## 20. Product / Shopify Rules

Recommended products should be represented separately from placed scene products.

Conceptually:

```text
ProductCandidate[]
```

contains all relevant options.

A selected candidate may become:

```text
SceneObject
```

after placement.

Keep source metadata such as:

- Shopify product ID,
- merchant,
- price,
- variant,
- availability,
- image/media URL,
- product URL,
- dimensions if available.

Never let Gemini invent a real product price or stock status.

If product dimensions are estimated from an image, mark them as estimated.

If sourced from merchant data, mark them as verified/source-backed.

---

## 21. Environment Variables & Secrets

Never commit:

- API keys,
- Shopify tokens,
- Gemini credentials,
- private URLs,
- personal access tokens.

Use:

```text
.env.local
```

or the repository's existing environment mechanism.

Maintain:

```text
.env.example
```

with variable names only.

Example:

```text
GEMINI_API_KEY=
SHOPIFY_...=
```

Before committing:

```bash
git diff --cached
```

Inspect for secrets.

---

## 22. Demo-First Development Rule

This is a hackathon.

Every feature must support the final live demo.

The preferred demo flow is:

```text
1. Load / generate a whole home.
2. Create household personas.
3. Furnish using real Shopify products.
4. Run household simulation.
5. Show a real measurable failure.
6. Ask Gemini to redesign.
7. Apply ScenePatch.
8. Re-run the same simulation.
9. Show before/after improvement.
10. Continue toward Shopify purchase.
```

A feature that does not strengthen this loop is lower priority.

Do not spend critical hackathon time on:

- authentication,
- user profile systems,
- admin dashboards,
- unrelated settings screens,
- large refactors,
- generic design-system work,
- infrastructure that is not visible or required for the demo.

---

## 23. Definition of Done

A feature is complete only when:

- it works on its feature branch,
- the intended user-visible behavior is demonstrable,
- shared contracts remain valid,
- it does not silently break the other workstream,
- tests/build are run,
- limitations are documented,
- the branch can be safely reviewed and merged.

Antigravity/Gemini must not report "done" merely because code was generated.

The final report must include actual verification evidence.

---

## 24. Final Instruction to All Coding Agents

When uncertain, optimize for:

1. working demo,
2. correctness,
3. deterministic verification,
4. clean integration boundaries,
5. speed,
6. visual polish,
7. architectural elegance.

Do not invert this order during the hackathon.
