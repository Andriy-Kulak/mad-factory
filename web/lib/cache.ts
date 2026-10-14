import "server-only";
import { unstable_cache } from "next/cache";

export const DATA_TTL_SECONDS = 300;
export const productTag = (productId: string) => `product:${productId}`;

/** Rejects return types that don't survive the JSON round trip unstable_cache stores them as. */
export type JsonSafe<T, Depth extends unknown[] = []> = T extends Map<unknown, unknown> | Set<unknown> | Date | ((...a: never[]) => unknown)
  ? never
  : Depth["length"] extends 6
    ? T
    : T extends readonly (infer Item)[]
      ? readonly JsonSafe<Item, [...Depth, unknown]>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K], [...Depth, unknown]> }
        : T;

/** Per-product server data cache: a hit returns at once; past the TTL the old copy is served while a fresh one loads in the background. The first argument must be the product id. */
export function cachedByProduct<A extends [productId: string, ...rest: unknown[]], R>(name: string, fn: (...args: A) => Promise<R & JsonSafe<R>>): (...args: A) => Promise<R> {
  return (...args) => unstable_cache(fn, [name], { revalidate: DATA_TTL_SECONDS, tags: [productTag(args[0])] })(...args);
}
