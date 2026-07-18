import { CREDIT_PACKAGES, type PackageKey } from "@pseo/core";

/**
 * Single source of PLAN + TOP-UP pricing, shared by the marketing pricing surfaces
 * (pricing table + top-ups section) and the in-app billing page. Prices are the Faz 1
 * figures and live here only. Credit COUNTS are never copied — they derive from
 * @pseo/core CREDIT_PACKAGES via creditsLabel(), so the ledger's package figures stay
 * the one source of truth (CLAUDE.md NEVER #6: no duplicated / drifting credit numbers).
 */

export type PlanKey = Extract<PackageKey, "trial" | "starter" | "pro" | "agency">;
export type TopUpKey = Extract<PackageKey, "topup_10" | "topup_25" | "topup_50">;

export interface Plan {
  readonly key: PlanKey;
  readonly name: string;
  readonly price: string;
  readonly period: string;
  readonly blurb: string;
}

export interface TopUp {
  readonly key: TopUpKey;
  readonly price: string;
}

export const PLANS: readonly Plan[] = [
  {
    key: "trial",
    name: "Trial",
    price: "$0",
    period: "one-time",
    blurb: "No card required. Verify your email and try the tools on a single domain.",
  },
  {
    key: "starter",
    name: "Starter",
    price: "$19",
    period: "per month",
    blurb: "For one site and a steady rhythm of audits and reports.",
  },
  {
    key: "pro",
    name: "Pro",
    price: "$49",
    period: "per month",
    blurb: "For growing sites that run research and audits often.",
  },
  {
    key: "agency",
    name: "Agency",
    price: "$149",
    period: "per month",
    blurb: "For multiple clients and heavier monthly workloads.",
  },
];

export const TOP_UPS: readonly TopUp[] = [
  { key: "topup_10", price: "$10" },
  { key: "topup_25", price: "$25" },
  { key: "topup_50", price: "$50" },
];

/** Human "1,000 credits" label derived from CREDIT_PACKAGES (never a copied number). */
export function creditsLabel(key: PackageKey): string {
  return `${formatCredits(CREDIT_PACKAGES[key].credits)} credits`;
}

/** Thousands separators, locale-independent and deterministic. */
function formatCredits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
