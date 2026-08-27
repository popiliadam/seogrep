import { z } from "zod";

/**
 * The four card shapes the 38 tools reduce to (spec §3). All four names exist from day one
 * because `card-map.ts` plans every tool's kind up front; the SCHEMA below grows one kind per
 * rollout slice, so a tool can never ship a card the template cannot draw.
 */
export const CARD_KINDS = ["metric", "list", "report", "action"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** One label/value row. Both non-empty: a card may not print a blank where a fact belongs. */
const factSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

/**
 * A single headline figure with a few supporting facts.
 *
 * `value` is a STRING, not a number: the card renders what the tool already decided to say, and a
 * number here would invite the view to format it — a second place for "4519" to become "4,519" or
 * "4.5k" while the text says something else.
 */
const metricCardSchema = z.object({
  kind: z.literal("metric"),
  title: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1).optional(),
  badge: z.string().min(1).optional(),
  facts: z.array(factSchema).max(6).default([]),
});

/**
 * A discriminated union with ONE member today. `list`, `report` and `action` join it in their own
 * slices; until then a card of that kind is REJECTED rather than silently rendered blank.
 */
export const cardSchema = z.discriminatedUnion("kind", [metricCardSchema]);
export type Card = z.infer<typeof cardSchema>;
