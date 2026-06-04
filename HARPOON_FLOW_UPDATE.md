# Harpoon-style command-loop UI update

The Decision Flow view is organized around a single operational loop:

1. Event enters the system.
2. The system generates grounded COAs.
3. The operator selects a feasible COA rather than manually composing actions.
4. The selected COA automatically loads its generated logistics matrix as the prepared order set.
5. The operator commits the prepared COA for execution.

### Three COA paths (operator revisions)

1. **Automated COA** — generated and scored by `runCoaPipeline()`. Immutable baseline.
2. **Operator-authored COA** — **Create Your Own COA** starts `Operator COA — Draft N`. Tasks live on a persisted candidate revision, not `__working__`.
3. **Operator-modified COA** — first matrix edit forks `COA N — Operator Modified v1` with `parentCoaId`. The automated parent stays unchanged.

**Validate Operator COA** materializes the visible matrix, then runs full pipeline-equivalent scoring (constraint re-check, effects engine, intel fidelity), stores `validatedOrderSet`, and re-ranks all COAs. **Import COA draft** creates an `imported` candidate from pasted task lines. **Merge into parent COA** uses an inline confirm banner (no browser dialog) and applies a validated operator-modified revision onto the automated parent. **Execute** commits `preparedExecution` / `executedSnapshot` (revision id, order set, evidence snapshot).

UI behavior changes:

- The main screen is framed as a Harpoon-style command loop.
- The analysis control is labeled **Generate COAs** / **Regenerate COAs**.
- COAs are described as complete playable responses.
- Infeasible COAs remain visible for explanation but cannot be selected.
- The selected feasible COA is marked **SELECTED · ORDERS LOADED**.
- The logistics panel is presented as generated execution orders.
- Execution is enabled only when a feasible COA is selected and its logistics matrix is populated.

Validation performed:

```bash
npm run typecheck
```

The source passed TypeScript validation. Run `npm install` on the target platform before building so Vite/Rollup installs the correct platform-specific optional package.

## Persistent operational map restoration

The Harpoon-style command loop now keeps the operational map mounted as a sticky left-side battlespace view while the generated COA workflow remains on the right. Selecting a map contact updates the inspected track without leaving the decision flow. On narrower screens, the map stacks above the workflow.
