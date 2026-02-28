# Extract Pure Logic for Unit Testing

## Overview

Refactor coupled modules (placement, windows, store, fancyzones, monitors) to extract pure computational logic into testable helper functions. Add comprehensive unit tests for the extracted logic.

## Context

- Files involved: `src/placement.js`, `src/windows.js`, `src/store.js`, `src/fancyzones.js`, `src/monitors.js`
- Related patterns: existing tests in `src/geometry.test.js`, `src/window-match.test.js`, `src/scale.test.js` use vitest with describe/it/expect
- Dependencies: vitest (already configured)

## Development Approach

- **Testing approach**: TDD where practical - write tests first for extracted functions, then extract
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Extract pure position resolver from parsePos (placement.js)

The `parsePos` function mixes config access with pure coordinate math. Extract the switch-based monitor-relative position resolution into a pure function.

**Files:**

- Modify: `src/placement.js`
- Create: `src/placement.test.js`
- Create `resolveMonitorRelativePos({ name, value, monBounds, panelWidth, panelHeight, monNum })` pure function that handles the switch(oper) logic currently inside parsePos
- Create `parsePosFromRule({ rule, mons, panelWidth, panelHeight })` pure function that wraps the full parsePos loop, taking config values as parameters instead of calling getConfig()
- Update `parsePos` to delegate to the new pure functions (passing config values through)
- Write tests for resolveMonitorRelativePos covering: top, right, bottom, left, x-2/3, x-3/3, width, halfWidth, thirdWidth, height, and edge cases (missing monitor, numeric values pass through)
- Write tests for parsePosFromRule covering: fancyZones delegation, missing pos, monitor-relative string parsing
- Run tests - must pass before task 2

### Task 2: Extract pure rule matching from windows.js

The `getMatchedRules` function calls getConfig() internally. Extract the pure filtering logic.

**Files:**

- Modify: `src/windows.js`
- Create: `src/windows.test.js`
- Create `matchRules(window, rules)` pure function that takes a window object and rules array, returns matched rules (with single-rule logic)
- Update `getMatchedRules` to delegate to matchRules
- Create `isWindowExcluded({ title, path, excludedTitles, excludedPaths })` pure function from the filtering logic in getWindows
- Write tests for matchRules: multiple matches, single rule priority, no matches, empty rules
- Write tests for isWindowExcluded: title exclusion, path exclusion, no exclusion
- Run tests - must pass before task 3

### Task 3: Extract pure store filtering from store.js

The `openWindows` and `openPaths` functions mix filtering logic with process spawning/exec.

**Files:**

- Modify: `src/store.js`
- Create: `src/store.test.js`
- Create `filterWindowsToRestore(storedWins, currentWins)` pure function that returns which windows need opening (filters out already-open ones, parses args from path)
- Create `filterPathsToRestore(storedPaths, currentWins)` pure function that returns paths not already open
- Create `matchStoredWindows(wins, matchList)` pure function extracted from storeWindows regex matching logic
- Update original functions to use the extracted helpers
- Write tests for filterWindowsToRestore: already open filtered out, new windows returned, arg parsing from .exe paths
- Write tests for filterPathsToRestore: already open filtered out, new paths returned
- Write tests for matchStoredWindows: regex matching, case insensitive, dot escaping
- Run tests - must pass before task 4

### Task 4: Extract pure fancyzones position calculation

The `fancyZonesToPos` mixes file reading with pure position math.

**Files:**

- Modify: `src/fancyzones.js`
- Create: `src/fancyzones.test.js`
- Create `calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset })` pure function that computes final position from zone data and monitor bounds (the pos calculation + gap/offset application currently inline in fancyZonesToPos)
- Update fancyZonesToPos to use calcFancyZonePos
- Write tests for calcFancyZonePos: basic zone placement, with gaps, with offset, combined gaps and offset
- Run tests - must pass before task 5

### Task 5: Extract pure monitor lookup from monitors.js

**Files:**

- Modify: `src/monitors.js`
- Create: `src/monitors.test.js`
- Create `findMonitorByPoint(mons, { x, y })` pure function (point-in-bounds check extracted from getMonitorByPoint)
- Create `findMonitorNumByName(monitorsSize, name)` pure function from getMonitorNumByName
- Create `sortMonitors(monitors, monitorsSize)` pure function from getSortedMonitors sorting logic
- Update original functions to delegate to pure helpers
- Write tests for findMonitorByPoint: point inside, point outside all, edge cases
- Write tests for findMonitorNumByName: found, not found
- Write tests for sortMonitors: by name priority, by coordinates fallback, y-offset threshold
- Run tests - must pass before task 6

### Task 6: Verify acceptance criteria

- Run full test suite (`npx vitest run`)
- Run linter if configured
- Verify all original functions still work (they delegate to pure helpers, behavior unchanged)
- Verify test coverage of new code

### Task 7: Update documentation

- Update CLAUDE.md if internal patterns changed (e.g., note about pure helper extraction pattern)
- Move this plan to `docs/plans/completed/`
