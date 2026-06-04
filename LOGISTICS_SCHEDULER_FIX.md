# Logistics scheduler fix

The logistics matrix is now driven by a deterministic resource-aware scheduler instead of fixed index-based spacing.

## What changed

- Validated intel actions are prioritized by time sensitivity, then confidence, then stable action ID.
- Each action is assigned its earliest feasible start time.
- Actions using different assets can execute in parallel.
- Actions sharing an asset are serialized to avoid double-booking.
- Multi-asset actions reserve all referenced assets for their full duration.
- Matrix lanes are built in scheduled-time order.
- Evidence dependencies now link every completed earlier action sharing cited facts, rather than only adjacent actions.
- Logistics scoring penalizes same-lane overlaps and avoids double-counting multi-asset chips as separate actions.

## Scope

This is a deterministic greedy scheduling heuristic. It is a meaningful improvement over pre-filled spacing, but it is not a full constraint-programming optimizer. Future inputs such as deadlines, capacity, route travel times, and replenishment constraints would support a stronger optimizer.

## Validation

The coherent nested project passes:

```bash
npm run typecheck
```

Vitest could not start in the provided archive because its bundled macOS `node_modules` directory lacks Rollup's Linux optional native dependency. Reinstall dependencies on the target machine before running tests:

```bash
rm -rf node_modules
npm install
npm test
```
