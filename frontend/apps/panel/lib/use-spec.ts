"use client";

import { useCallback, useEffect, useState } from "react";
import { SAMPLE_SPEC, type TaskSpec } from "./spec";

const KEY = "hybrid-gate.spec";

/**
 * Frontend-only persistence for the intake output. Browser storage is a
 * per-viewer convenience here; the runner will own tasks/<spec_id>.json later.
 */
export const useSpec = () => {
  const [spec, setSpecState] = useState<TaskSpec>(SAMPLE_SPEC);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<"sample" | "saved">("sample");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        setSpecState(JSON.parse(raw) as TaskSpec);
        setSource("saved");
      }
    } catch {
      // storage unavailable: keep the sample spec
    }
    setReady(true);
  }, []);

  const setSpec = useCallback((next: TaskSpec) => {
    setSpecState(next);
    setSource("saved");
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setSpecState(SAMPLE_SPEC);
    setSource("sample");
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }, []);

  return { spec, setSpec, reset, ready, source };
};
