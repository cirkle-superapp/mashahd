"use client";

import { create } from "zustand";

/**
 * Command Palette store (adapted from CIRKLE's command-palette.tsx).
 *
 * A single global instance controls the open/close state of the ⌘K palette.
 * Any component can call `open()` / `close()` / `toggle()`.
 */
type PaletteState = {
  open: boolean;
  openPalette: () => void;
  close: () => void;
  toggle: () => void;
};

export const useCommandPalette = create<PaletteState>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
