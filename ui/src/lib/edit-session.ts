// ui/src/lib/edit-session.ts — frozen edit session (EPIC 026, decision 1).
//
// The session freezes {baseData, baseEtag, draft} when opened. submit() uses
// the frozen baseEtag verbatim — never a cache value, never a render-time prop.
// A 412 triggers a fresh load for the three-version conflict state; reload()
// re-arms with the new validator while keeping the draft intact.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, Etagged } from "./api-client.ts";

export type EditSessionStatus =
  | "closed"
  | "loading"
  | "editing"
  | "submitting"
  | "conflict"
  | "rearming"
  | "missing"
  | "client-defect"
  | "error";

export interface EditSessionOptions<T, D> {
  readonly load: () => Promise<Etagged<T>>;
  readonly toDraft: (data: T) => D;
  readonly save: (draft: D, ifMatch: string) => Promise<Etagged<T>>;
  readonly onSaved?: (saved: Etagged<T>) => void | Promise<void>;
}

export interface EditSession<T, D> {
  readonly status: EditSessionStatus;
  readonly base: Etagged<T> | null;
  readonly draft: D | null;
  readonly current: T | null;
  readonly error: ApiError | Error | null;
  open(): void;
  close(): void;
  setDraft(draft: D): void;
  submit(): void;
  reload(): void;
  reset(): void;
}

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && e.name === "ApiError";
}

function wrapError(err: unknown): Error {
  if (isApiError(err)) return err;
  return new Error(String(err));
}

export function useEditSession<T, D>(
  options: EditSessionOptions<T, D>,
): EditSession<T, D> {
  const { load, toDraft, save, onSaved } = options;

  // base lives in a ref, mirrored into state for rendering.
  // Written in exactly three places: loading resolve, rearming resolve, reset().
  const baseRef = useRef<Etagged<T> | null>(null);
  const [baseState, setBaseState] = useState<Etagged<T> | null>(null);

  const [status, setStatus] = useState<EditSessionStatus>("closed");
  const [draft, setDraftState] = useState<D | null>(null);
  const [current, setCurrent] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  // stale-response guard: increments at the head of open, submit, reload, reset
  const attemptRef = useRef(0);

  // bump on unmount so a late resolution cannot set state
  useEffect(() => {
    return () => {
      attemptRef.current += 1;
    };
  }, []);

  const setBase = useCallback((value: Etagged<T> | null) => {
    baseRef.current = value;
    setBaseState(value);
  }, []);

  // shared load → editing transition (used by open, reload via rearming, reset)
  const doLoad = useCallback(
    async (captured: number, target: "editing" | "rearming") => {
      try {
        const result = await load();
        if (captured !== attemptRef.current) return;
        setBase({ data: result.data, etag: result.etag });
        if (target === "editing") {
          setDraftState(toDraft(result.data));
        }
        // rearming: draft unchanged
        setCurrent(null);
        setError(null);
        setStatus("editing");
      } catch (err: unknown) {
        if (captured !== attemptRef.current) return;
        if (isApiError(err) && err.status === 404) {
          setError(err);
          setStatus("missing");
        } else {
          setError(wrapError(err));
          setStatus("error");
        }
      }
    },
    [load, toDraft, setBase],
  );

  const open = useCallback(() => {
    const captured = ++attemptRef.current;
    setStatus("loading");
    void doLoad(captured, "editing");
  }, [doLoad]);

  const close = useCallback(() => {
    attemptRef.current += 1;
    setBase(null);
    setDraftState(null);
    setCurrent(null);
    setError(null);
    setStatus("closed");
  }, [setBase]);

  const setDraftFn = useCallback((d: D) => {
    setDraftState(d);
  }, []);

  const submit = useCallback(() => {
    if (!baseRef.current) return;
    const captured = ++attemptRef.current;
    const currentBase = baseRef.current;
    const currentDraft = draft;
    if (currentDraft === null) return;

    setStatus("submitting");

    save(currentDraft, currentBase.etag)
      .then(async (saved) => {
        if (captured !== attemptRef.current) return;
        if (onSaved) await onSaved(saved);
        if (captured !== attemptRef.current) return;
        setBase(null);
        setDraftState(null);
        setCurrent(null);
        setError(null);
        setStatus("closed");
      })
      .catch(async (err: unknown) => {
        if (captured !== attemptRef.current) return;
        if (!isApiError(err)) {
          setError(wrapError(err));
          setStatus("error");
          return;
        }

        if (err.status === 412) {
          // 412 → call load(); on resolve set current, go to conflict
          try {
            const fresh = await load();
            if (captured !== attemptRef.current) return;
            setCurrent(fresh.data);
            setStatus("conflict");
          } catch (loadErr: unknown) {
            if (captured !== attemptRef.current) return;
            if (isApiError(loadErr) && loadErr.status === 404) {
              setError(loadErr);
              setStatus("missing");
            } else {
              setError(wrapError(loadErr));
              setStatus("error");
            }
          }
        } else if (err.status === 428) {
          setError(err);
          setStatus("client-defect");
        } else if (err.status === 404) {
          setError(err);
          setStatus("missing");
        } else {
          setError(err);
          setStatus("error");
        }
      });
  }, [draft, save, load, onSaved, setBase]);

  const reload = useCallback(() => {
    const captured = ++attemptRef.current;
    setStatus("rearming");
    void doLoad(captured, "rearming");
  }, [doLoad]);

  const reset = useCallback(() => {
    const captured = ++attemptRef.current;
    setStatus("loading");
    (async () => {
      try {
        const result = await load();
        if (captured !== attemptRef.current) return;
        setBase({ data: result.data, etag: result.etag });
        setDraftState(toDraft(result.data));
        setCurrent(null);
        setError(null);
        setStatus("editing");
      } catch (err: unknown) {
        if (captured !== attemptRef.current) return;
        if (isApiError(err) && err.status === 404) {
          setError(err);
          setStatus("missing");
        } else {
          setError(wrapError(err));
          setStatus("error");
        }
      }
    })();
  }, [load, toDraft, setBase]);

  return {
    status,
    base: baseState,
    draft,
    current,
    error,
    open,
    close,
    setDraft: setDraftFn,
    submit,
    reload,
    reset,
  };
}
