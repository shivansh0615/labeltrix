import { clearSessionCookieHeader } from "../../../lib/auth";

export async function POST(request: Request) {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookieHeader(request.url),
      },
    },
  );
}
