// TEMPORARY QA SWITCH: set this back to false after the Baisha corridor chase
// has been verified. It is development-only and never changes production flow.
export const BAISHA_DIRECT_CHASE_TEST_DEFAULT = false;

export function shouldUseBaishaDirectChaseTest(): boolean {
  if (!import.meta.env.DEV) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get("fullStory") === "1") return false;

  return BAISHA_DIRECT_CHASE_TEST_DEFAULT
    || params.get("baishaChaseOnly") === "1";
}
