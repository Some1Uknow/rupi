import { NextResponse } from "next/server";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
  }
}

/**
 * Read a request body with a streaming byte limit. Content-Length alone is not
 * an enforcement boundary because a chunked request may omit or lie about it.
 */
export async function readRawBody(request: Request, maximumBytes = 256_000): Promise<string> {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maximumBytes) throw new RequestBodyTooLargeError();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) throw new RequestBodyTooLargeError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Request body must be valid UTF-8.");
  }
}

export async function readJsonBody<T>(request: Request, maximumBytes = 256_000): Promise<T> {
  const raw = await readRawBody(request, maximumBytes);
  if (!raw.trim()) throw new Error("Invalid JSON body.");
  const body = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON body.");
    }
  })();
  if (body === null || typeof body !== "object") {
    throw new Error("Invalid JSON body.");
  }
  return body as T;
}

export function apiError(error: unknown, fallback: string, status = 400) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}
