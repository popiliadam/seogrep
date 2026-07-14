import { joinWaitlist, WaitlistValidationError } from "@pseo/core";
import { getWaitlistDeps } from "../../../lib/waitlist-deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.website === "string" && body.website.length > 0) {
    return Response.json({ ok: true });
  }
  const deps = getWaitlistDeps();
  if (!deps) {
    return Response.json(
      { ok: false, error: "Waitlist is not configured yet. Please try again soon." },
      { status: 503 },
    );
  }
  try {
    const result = await joinWaitlist({ email: body.email, source: body.source ?? "landing" }, deps);
    return Response.json(result);
  } catch (error) {
    if (error instanceof WaitlistValidationError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("waitlist signup failed:", error);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
