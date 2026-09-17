import { getRedisClient } from "../config/redis.js";

const FAIL_TTL_SECONDS = 600;
const memoryCache = new Map();

export async function isModelFailed(model) {
    const key = `fail:model:${model}`;
    const mem = memoryCache.get(key);
    if (mem && mem > Date.now()) return true;
    if (mem && mem <= Date.now()) memoryCache.delete(key);
    const c = await getRedisClient();
    if (!c) return false;
    try {
        const val = await c.get(key);
        return Boolean(val);
    } catch {
        return false;
    }
}

export async function markModelFailed(model) {
    const key = `fail:model:${model}`;
    memoryCache.set(key, Date.now() + FAIL_TTL_SECONDS * 1000);
    const c = await getRedisClient();
    if (!c) return;
    try { await c.set(key, "1", { EX: FAIL_TTL_SECONDS }); } catch {}
}

export async function clearModelFailed(model) {
    const key = `fail:model:${model}`;
    memoryCache.delete(key);
    const c = await getRedisClient();
    if (!c) return;
    try { await c.del(key); } catch {}
}
