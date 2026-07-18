/**
 * Credit packages (spec §3). These literals are pinned by a deep-equal test —
 * changing any number requires human approval (CLAUDE.md NEVER #6: price / credit
 * cost / package figures do not change without human sign-off across code + docs + pricing).
 */
export const CREDIT_PACKAGES = {
  trial: { credits: 200, oneTime: true },
  starter: { credits: 1_000, oneTime: false },
  pro: { credits: 3_500, oneTime: false },
  agency: { credits: 12_000, oneTime: false },
  topup_10: { credits: 400, oneTime: true },
  topup_25: { credits: 1_100, oneTime: true },
  topup_50: { credits: 2_400, oneTime: true },
} as const;

export type PackageKey = keyof typeof CREDIT_PACKAGES;
