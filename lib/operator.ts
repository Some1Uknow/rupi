import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export function requireOperator(request: Request) {
  const configured = process.env.OPERATOR_API_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expectedBytes = Buffer.from(configured || "");
  const suppliedBytes = Buffer.from(supplied);
  if (!configured || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return null;
  }
  return request.headers.get("x-operator-id")?.trim().slice(0, 120) || "operator";
}

export function operatorUnauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
