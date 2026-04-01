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

- [x] Modify: `src/placement.js`
- [x] Create: `src/placement.test.js`
- [x] Create `resolveMonitorRelativePos({ name, value, monBounds, panelWidth, panelHeight, monNum })` pure function that handles the switch(oper) logic currently inside parsePos
- [x] Create `parsePosFromRule({ rule, mons, panelWidth, panelHeight })` pure function that wraps the full parsePos loop, taking config values as parameters instead of calling getConfig()
- [x] Update `parsePos` to delegate to the new pure functions (passing config values through)
- [x] Write tests for resolveMonitorRelativePos covering: top, right, bottom, left, x-2/3, x-3/3, width, halfWidth, thirdWidth, height, and edge cases (missing monitor, numeric values pass through)
- [x] Write tests for parsePosFromRule covering: fancyZones delegation, missing pos, monitor-relative string parsing
- [x] Run tests - must pass before task 2

### Task 2: Extract pure rule matching from windows.js

The `getMatchedRules` function calls getConfig() internally. Extract the pure filtering logic.

**Files:**

- [x] Modify: `src/windows.js`
- [x] Create: `src/windows.test.js`
- [x] Create `matchRules(window, rules)` pure function that takes a window object and rules array, returns matched rules (with single-rule logic)
- [x] Update `getMatchedRules` to delegate to matchRules
- [x] Create `isWindowExcluded({ title, path, excludedTitles, excludedPaths })` pure function from the filtering logic in getWindows
- [x] Write tests for matchRules: multiple matches, single rule priority, no matches, empty rules
- [x] Write tests for isWindowExcluded: title exclusion, path exclusion, no exclusion
- [x] Run tests - must pass before task 3

### Task 3: Extract pure store filtering from store.js

The `openWindows` and `openPaths` functions mix filtering logic with process spawning/exec.

**Files:**

- [x] Modify: `src/store.js`
- [x] Create: `src/store.test.js`
- [x] Create `filterWindowsToRestore(storedWins, currentWins)` pure function that returns which windows need opening (filters out already-open ones, parses args from path)
- [x] Create `filterPathsToRestore(storedPaths, currentWins)` pure function that returns paths not already open
- [x] Create `matchStoredWindows(wins, matchList)` pure function extracted from storeWindows regex matching logic
- [x] Update original functions to use the extracted helpers
- [x] Write tests for filterWindowsToRestore: already open filtered out, new windows returned, arg parsing from .exe paths
- [x] Write tests for filterPathsToRestore: already open filtered out, new paths returned
- [x] Write tests for matchStoredWindows: regex matching, case insensitive, dot escaping
- [x] Run tests - must pass before task 4

### Task 4: Extract pure fancyzones position calculation

The `fancyZonesToPos` mixes file reading with pure position math.

**Files:**

- [x] Modify: `src/fancyzones.js`
- [x] Create: `src/fancyzones.test.js`
- [x] Create `calcFancyZonePos({ zone, monBounds, monitorGaps, monitorsOffset })` pure function that computes final position from zone data and monitor bounds (the pos calculation + gap/offset application currently inline in fancyZonesToPos)
- [x] Update fancyZonesToPos to use calcFancyZonePos
- [x] Write tests for calcFancyZonePos: basic zone placement, with gaps, with offset, combined gaps and offset
- [x] Run tests - must pass before task 5

### Task 5: Extract pure monitor lookup from monitors.js

**Files:**

- [x] Modify: `src/monitors.js`
- [x] Create: `src/monitors.test.js`
- [x] Create `findMonitorByPoint(mons, { x, y })` pure function (point-in-bounds check extracted from getMonitorByPoint)
- [x] Create `findMonitorNumByName(monitorsSize, name)` pure function from getMonitorNumByName
- [x] Create `sortMonitors(monitors, monitorsSize)` pure function from getSortedMonitors sorting logic
- [x] Update original functions to delegate to pure helpers
- [x] Write tests for findMonitorByPoint: point inside, point outside all, edge cases
- [x] Write tests for findMonitorNumByName: found, not found
- [x] Write tests for sortMonitors: by name priority, by coordinates fallback, y-offset threshold
- [x] Run tests - must pass before task 6

### Task 6: Verify acceptance criteria

- [x] Run full test suite (`npx vitest run`)
- [x] Run linter if configured
- [x] Verify all original functions still work (they delegate to pure helpers, behavior unchanged)
- [x] Verify test coverage of new code

### Task 7: Update documentation

- [x] Update CLAUDE.md if internal patterns changed (e.g., note about pure helper extraction pattern)
- [x] Move this plan to `docs/plans/completed/`
