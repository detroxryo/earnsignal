import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "./env";

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export const requireAdmin: MiddlewareHandler<{ Bindings: AppBindings }> = async (context, next) => {
  const configured = context.env.ADMIN_TOKEN;
  const authorization = context.req.header("Authorization");
  if (!configured || !authorization?.startsWith("Bearer ")) {
    return context.json({ error: "unauthorized" }, 401);
  }
  const supplied = authorization.slice("Bearer ".length);
  const [expectedHash, suppliedHash] = await Promise.all([digest(configured), digest(supplied)]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
  };
  if (!subtle.timingSafeEqual(expectedHash, suppliedHash)) {
    return context.json({ error: "unauthorized" }, 401);
  }
  await next();
};
