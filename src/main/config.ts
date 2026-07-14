/**
 * Global configuration constants for the analytics platform.
 */

/**
 * A calendar day D is "completed" only once at least this many hours have
 * passed since the end of D (i.e. now >= midnight(D+1) + COMPLETED_HOURS).
 * This buffer lets Meta spend finalize and GA4 finish processing.
 */
export const COMPLETED_HOURS = 12;

/** Meta Marketing API version (v23.0 expired June 2026 — keep pinned & current). */
export const META_API_VERSION = "v25.0";

/** GA4 Data API version. */
export const GA4_API_VERSION = "v1beta";

/** How many nth-days of cohort data we track per install-day (D0..D7). */
export const COHORT_MAX_NTH_DAY = 7;

/**
 * Meta occasionally restates spend for recent days after they complete.
 * The trailing N completed days are always re-fetched on sync as insurance.
 */
export const META_RESTATEMENT_DAYS = 3;

/**
 * All daily bucketing happens in this timezone. Both the Meta ad account and
 * the GA4 property must be configured to this timezone or daily rows won't
 * line up (see plan §8.2). MVP assumes UTC.
 */
export const REPORTING_TIMEZONE = "UTC";
