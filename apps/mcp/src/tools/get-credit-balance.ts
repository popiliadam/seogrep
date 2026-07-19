import { z } from "zod";
import { creditBalance, getServiceClient } from "../db.ts";
import { defineTool, textResult } from "./registry.ts";

/**
 * get_credit_balance — the tenant's available credits. 0 credits (reading your balance
 * is free). Balance is the tenant-scoped Σ of the credit ledger (constitution NEVER #2:
 * it derives only from the ledger, never a stored counter); the read is scoped in db.ts.
 */
export const getCreditBalanceTool = defineTool({
  name: "get_credit_balance",
  description: "Show your available credit balance (the running total of your credit ledger).",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const balance = await creditBalance(getServiceClient(), ctx.userId);
    const unit = balance === 1 ? "credit" : "credits";
    return textResult(
      `Credit balance: ${balance} ${unit}. Paid tools debit credits when they run; ` +
        "a balance of 0 blocks paid tools until you top up.",
    );
  },
});
