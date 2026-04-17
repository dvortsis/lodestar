"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AUTO_EXPAND_FILES_STORAGE_KEY } from "@/config/constant";

type AutoExpandCtx = {
  autoExpand: boolean;
  setAutoExpand: (next: boolean) => void;
};

const AutoExpandFilesContext = createContext<AutoExpandCtx | null>(null);

export function AutoExpandFilesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [autoExpand, setAutoExpandState] = useState(false);

  useEffect(() => {
    try {
      setAutoExpandState(
        typeof window !== "undefined" &&
          localStorage.getItem(AUTO_EXPAND_FILES_STORAGE_KEY) === "1",
      );
    } catch {
      setAutoExpandState(false);
    }
  }, []);

  const setAutoExpand = useCallback((next: boolean) => {
    setAutoExpandState(next);
    try {
      localStorage.setItem(AUTO_EXPAND_FILES_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ autoExpand, setAutoExpand }),
    [autoExpand, setAutoExpand],
  );

  return (
    <AutoExpandFilesContext.Provider value={value}>
      {children}
    </AutoExpandFilesContext.Provider>
  );
}

export function useAutoExpandFiles(): AutoExpandCtx {
  const ctx = useContext(AutoExpandFilesContext);
  if (!ctx) {
    return {
      autoExpand: false,
      setAutoExpand: () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}
