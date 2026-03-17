import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "fake-indexeddb/auto";

import { useDocumentManager } from "../hooks/useDocumentManager";

describe("useDocumentManager", () => {
  it("should start not ready and become ready", async () => {
    const { result } = renderHook(() => useDocumentManager());
    expect(result.current.ready).toBe(false);

    await vi.waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.currentDocument).toBeNull();
  });

  it("should create a document and set it as current", async () => {
    const { result } = renderHook(() => useDocumentManager());
    await vi.waitFor(() => expect(result.current.ready).toBe(true));

    let doc: Awaited<ReturnType<typeof result.current.createDocument>>;
    await act(async () => {
      doc = await result.current.createDocument("Test Doc", 800, 600, 72);
    });

    expect(doc!.name).toBe("Test Doc");
    expect(doc!.width).toBe(800);
    expect(doc!.height).toBe(600);
    expect(doc!.ppi).toBe(72);
    expect(result.current.documents.some(d => d.id === doc!.id)).toBe(true);
    expect(result.current.currentDocument?.id).toBe(doc!.id);
  });

  it("should open an existing document", async () => {
    const { result } = renderHook(() => useDocumentManager());
    await vi.waitFor(() => expect(result.current.ready).toBe(true));

    let doc: Awaited<ReturnType<typeof result.current.createDocument>>;
    await act(async () => {
      doc = await result.current.createDocument("Doc 1", 100, 100, 72);
    });

    // Close document
    act(() => result.current.closeDocument());
    expect(result.current.currentDocument).toBeNull();

    // Open it again (async — loads chunks from storage)
    await act(async () => {
      await result.current.openDocument(doc!.id);
    });
    expect(result.current.currentDocument?.id).toBe(doc!.id);
  });

  it("should delete a document", async () => {
    const { result } = renderHook(() => useDocumentManager());
    await vi.waitFor(() => expect(result.current.ready).toBe(true));

    let doc: Awaited<ReturnType<typeof result.current.createDocument>>;
    await act(async () => {
      doc = await result.current.createDocument("To Delete", 100, 100, 72);
    });
    const countBefore = result.current.documents.length;

    await act(async () => {
      await result.current.deleteDocument(doc!.id);
    });
    expect(result.current.documents.length).toBe(countBefore - 1);
    expect(result.current.documents.find(d => d.id === doc!.id)).toBeUndefined();
    expect(result.current.currentDocument).toBeNull();
  });

  it("should rename a document", async () => {
    const { result } = renderHook(() => useDocumentManager());
    await vi.waitFor(() => expect(result.current.ready).toBe(true));

    let doc: Awaited<ReturnType<typeof result.current.createDocument>>;
    await act(async () => {
      doc = await result.current.createDocument("Original", 100, 100, 72);
    });

    await act(async () => {
      await result.current.renameDocument(doc!.id, "Renamed");
    });

    const found = result.current.documents.find(d => d.id === doc!.id);
    expect(found?.name).toBe("Renamed");
    expect(result.current.currentDocument?.name).toBe("Renamed");
  });
});
