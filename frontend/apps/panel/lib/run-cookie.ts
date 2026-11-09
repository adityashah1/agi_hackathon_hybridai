/** Cookie that remembers which run the panel is showing. Shared by server and client code. */
export const RUN_COOKIE = "hg_run";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

/** Run ids become directory names under data/runs, so they must be plain. */
export const isSafeRunId = (id: string): boolean => SAFE_ID.test(id);
