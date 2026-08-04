import { authErrorResponse, requireSession } from "../../../lib/auth";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return Response.json({ role: session.role });
  } catch (error) {
    return authErrorResponse(error);
  }
}
