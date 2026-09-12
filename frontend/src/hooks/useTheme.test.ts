import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("defaults to light when no preference is saved", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("reads a saved dark preference from localStorage on mount", () => {
    localStorage.setItem("icevue.theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("ignores unknown saved values and falls back to light", () => {
    localStorage.setItem("icevue.theme", "system");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("sets data-theme on document.documentElement to match the active theme", () => {
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe(result.current.theme);
  });

  it("updates data-theme to dark when a dark preference is loaded", () => {
    localStorage.setItem("icevue.theme", "dark");
    renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggles from light to dark", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("icevue.theme")).toBe("dark");
  });

  it("toggles from dark to light", () => {
    localStorage.setItem("icevue.theme", "dark");
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("icevue.theme")).toBe("light");
  });

  it("persists successive toggles to localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());
    expect(localStorage.getItem("icevue.theme")).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(localStorage.getItem("icevue.theme")).toBe("light");
  });

  it("returns a stable toggleTheme reference across renders", () => {
    const { result, rerender } = renderHook(() => useTheme());
    const first = result.current.toggleTheme;
    rerender();
    expect(result.current.toggleTheme).toBe(first);
  });
});
