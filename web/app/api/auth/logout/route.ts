import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", appOrigin(req.nextUrl.origin)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
