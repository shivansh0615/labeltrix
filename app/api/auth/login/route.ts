import {
  AuthError,
  authErrorResponse,
  createSessionToken,
  sessionCookieHeader,
  verifyPassword,
  type AuthRole,
} from "../../../lib/auth";

function parseRole(value: unknown): AuthRole | null {
  return value === "admin" || value === "viewer" ? value : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      role?: unknown;
      password?: unknown;
    };
    const role = parseRole(body.role);
    const password = typeof body.password === "string" ? body.password : "";
    if (!role) {
      throw new AuthError("Choose Admin or Viewer access.", 400);
    }
    if (!password) {
      throw new AuthError("Enter the access password.", 400);
    }
    if (!verifyPassword(role, password)) {
      throw new AuthError("Invalid password for that access level.", 401);
    }
    const token = await createSessionToken(role);
    return Response.json(
      { role },
      {
        headers: {
          "Set-Cookie": sessionCookieHeader(token, request.url),
        },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
