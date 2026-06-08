import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me",
  );
}

/** Block access to app pages unless a valid login session cookie is present. */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get("niwa_session")?.value;
  if (token) {
    try {
      await jwtVerify(token, secretKey());
      return NextResponse.next();
    } catch {
      /* fall through to redirect */
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/maps/:path*"],
};
