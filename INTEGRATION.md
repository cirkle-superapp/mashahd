# Mashahd (مشاهِد) — Super-App Integration Guide

Mashahd is the **video pillar** of the super-app, alongside the sibling
modules **Wasl** (chat), **Lamahat** (photos), and **Midan** (public square).
This document describes how a parent super-app shell embeds and talks to
Mashahd.

## Embedding

Mashahd is a Next.js 16 app mounted at `/`. To embed it inside a parent
shell you have two options:

1. **iframe** — point an iframe at the Mashahd origin. Mashahd sets
   `theme-color` and works standalone. Use the bridge (below) for
   navigation via `postMessage`.

2. **Micro-frontend** — mount Mashahd's root under a path prefix and
   host it in a sub-router of the shell. The single user-visible route
   is `/`; everything else is a client-side view synced to URL query
   params (`?v=watch&id=...`), so deep-linking from the shell is trivial.

## The `window.mashahd` bridge

On the client, Mashahd exposes a stable, versioned surface:

```ts
interface MashahdBridge {
  id: "mashahd";
  version: "1.0.0";
  navigate(view: MashahdView): string;   // returns the resulting URL
  getView(): MashahdView;                // read current view
  onNavigate(cb: (view: MashahdView) => void): () => void;  // subscribe
  exit(): void;                           // hand control back to the shell
}

type MashahdView =
  | { kind: "home" }
  | { kind: "watch"; videoId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "search"; query: string }
  | { kind: "trending" }
  | { kind: "subscriptions" }
  | { kind: "history" }
  | { kind: "liked" }
  | { kind: "library" }
  | { kind: "category"; category: string }
  | { kind: "settings"; tab?: string };
```

### Feature-detect

```ts
if (typeof window !== "undefined" && window.mashahd?.id === "mashahd") {
  // Mashahd is mounted and ready.
}
```

### Navigate the user into a video

```ts
window.mashahd!.navigate({ kind: "watch", videoId: "abc123" });
// -> "/?v=watch&id=abc123"
```

### Listen for internal navigation

```ts
const off = window.mashahd!.onNavigate((view) => {
  console.log("Mashahd moved to", view.kind);
  // update the shell's active-tab highlight, breadcrumb, etc.
});
// later
off();
```

Mashahd also dispatches a `mashahd:navigate` `CustomEvent` on `window`
with the same payload, so non-subscriber listeners work too.

### Ask Mashahd to exit

```ts
window.mashahd!.exit();
// dispatches a `mashahd:exit` CustomEvent — the shell listens and
// unmounts / switches focus back to itself.
```

```ts
window.addEventListener("mashahd:exit", () => {
  // shell: hide the Mashahd panel, return to the home grid, etc.
});
```

## Deep-linking

Every Mashahd view is URL-addressable, so the shell can deep-link
without going through the bridge:

| View | URL |
|------|-----|
| Home | `/` |
| Watch | `/?v=watch&id=<videoId>` |
| Channel | `/?v=channel&id=<channelId>` |
| Search | `/?v=search&q=<query>` |
| Trending | `/?v=trending` |
| Subscriptions | `/?v=subscriptions` |
| History | `/?v=history` |
| Liked | `/?v=liked` |
| Library | `/?v=library` |
| Category | `/?v=category&cat=<Category>` |
| Settings | `/?v=settings[&tab=general\|report\|help\|feedback]` |

## Theming

Mashahd shares the super-app's brand palette (sand-gold, deep teal,
cream). The theme is controlled by `localStorage["mashahd-theme"]`
(`"light"` | `"dark"`); the parent shell can set this before mounting
to force a theme. The `<html>` element receives the `dark` class.

## Sibling modules (planned)

Mashahd is one of four pillars. When the others are mounted in the
same shell, each should expose a parallel bridge:

- `window.waslat` — chat (وصل)
- `window.mashahd` — video (مشاهِد) ← **this module**
- `window.lamahat` — photos (لمحات)
- `window.midan` — public square (ميدان)

The shell orchestrates between them via their respective bridges.
