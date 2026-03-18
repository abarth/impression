# Multiplayer Design

Impression's operation log is designed to support real-time collaborative editing where multiple users paint on the same canvas simultaneously. This document describes the data model and constraints that make conflict-free multiplayer possible.

## Core concepts

### Site ID

Every session (browser tab) is assigned a **site ID** (`u32`). In single-player mode, the site ID is always `0`. In multiplayer, each connected user receives a unique site ID from the server.

Operations carry the site ID of the session that created them. This determines:

- **Undo scope**: a user can only undo their own operations.
- **Per-site state**: brush settings, selection mask, stroke state, and lasso points are isolated per site.

### Layer ID

Layers are identified by a globally unique `LayerId` (`u64`), not by their position in the layer stack. The ID is generated as `(site_id << 32) | counter` so that different sites never produce colliding IDs.

The rendering order of layers is maintained as an ordered list. External APIs (WASM boundary, GPU texture arrays) still use positional indices for convenience — these are translated to/from `LayerId` internally.

### Operation wrapper

Every operation is wrapped in a `SiteOperation`:

```rust
pub struct SiteOperation {
    pub site: SiteId,
    pub op: Operation,
}
```

The inner `Operation` enum describes _what_ happened. The wrapper adds _who_ did it.

## State partitioning

### Shared state (visible to all users)

- **Layer pixel buffers** — all users draw onto the same layers.
- **Layer properties** — opacity, blend mode, visibility.
- **Layer ordering** — the render order of layers.
- **Background color** and canvas visibility.

### Per-site state (isolated per user)

- **Brush settings** — size, spacing, color, opacity, flow, blend mode. Changing your brush does not affect other users.
- **Stroke state** — the in-progress stroke (snapshot, stroke buffer, residual distance). Each user has their own active stroke.
- **Selection mask** — each user has their own selection, used to clip their own brush strokes.
- **Lasso points** — the in-progress lasso polygon.

Per-site state is stored in `Canvas.sites: HashMap<SiteId, SiteState>`. The `active_site` field determines which site's state is used for the current operation.

## Undo/redo

Undo is **per-site**: pressing Ctrl+Z only undoes your own most recent action. Other users' operations are never affected by your undo.

### Undo groups

Each undo group is tagged with its originating `SiteId`. The oplog tracks groups as:

```rust
struct UndoGroup {
    site: SiteId,
    start: usize,   // first operation index (inclusive)
    end: usize,     // last operation index (exclusive)
    undone: bool,    // whether this group has been undone
}
```

### Undo algorithm

1. **Undo(site)**: Find the last non-undone group for this site. Mark it `undone = true`.
2. **Redo(site)**: Find the earliest undone group for this site that comes after its last active group. Mark it `undone = false`.
3. **New action(site)**: Discard all undone groups for this site (the redo stack).

### Replay

After undo/redo, the canvas replays all **active** operations (those in non-undone groups) in log order. This naturally interleaves operations from multiple sites while skipping the undone ones.

## Conflict resolution

### Commutative pixel operations

Two users drawing on the same layer produces valid results regardless of operation order. The final pixels depend on the interleaving, but both strokes appear. This is analogous to two people drawing on the same sheet of paper — the result is the union of both strokes.

### Layer creation

`AddLayer` carries a `LayerId`. Two sites creating layers simultaneously produce distinct IDs (guaranteed by the `(site_id << 32) | counter` scheme). Both layers appear in the stack.

### Layer property conflicts

If two users change the same layer's opacity simultaneously, the last write wins. This is acceptable because layer properties are simple scalar values, and the user can see the final result and adjust.

### Brush settings

Brush settings are per-site, so no conflicts are possible. Each user's brush changes only affect their own strokes.

### Selection

Selections are per-site, so no conflicts are possible. Each user has their own selection mask.

## Persistence and synchronization

### Current (single-player)

Operations are flushed to IndexedDB in chunks. The flush cursor tracks which operations have been persisted.

### Future (multiplayer)

Operations will be synchronized to a cloud database. Each operation's `SiteOperation` wrapper provides the site ID needed for conflict resolution and per-site undo. The append-only log structure makes synchronization straightforward — each site appends its operations, and the server merges them in causal order.

The serialization format (postcard) supports `SiteOperation` natively. The flush/persistence API continues to work unchanged — it simply serializes `SiteOperation` values instead of bare `Operation` values.

## Constraints for future development

1. **All new operations must be wrapped in `SiteOperation`**. Never record a bare `Operation`.
2. **State that differs per user must go in `SiteState`**, not on `Canvas` directly.
3. **Layer references must use `LayerId`**, never positional indices, in operations.
4. **Undo groups must be tagged with `SiteId`**. The per-site undo invariant must be maintained.
5. **New shared state** (e.g., layer groups, text layers) should use stable IDs, not indices.
6. **Coalescing** only applies within the same site and same undo group.
