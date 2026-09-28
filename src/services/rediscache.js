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

const OWNER_ACTIVE_TTL_SECONDS = 5 * 60;

export async function markOwnerActive(chatid) {
    const key = `owner:active:${chatid}`;
    memoryCache.set(key, Date.now() + OWNER_ACTIVE_TTL_SECONDS * 1000);
    const c = await getRedisClient();
    if (!c) return;
    try { await c.set(key, "1", { EX: OWNER_ACTIVE_TTL_SECONDS }); } catch {}
}

export async function isOwnerActive(chatid) {
    const key = `owner:active:${chatid}`;
    const mem = memoryCache.get(key);
    if (mem && mem > Date.now()) return true;
    const c = await getRedisClient();
    if (!c) return false;
    try {
        return Boolean(await c.get(key));
    } catch {
        return false;
    }
}

const ALBUM_WAIT_MS = 2000;

export async function collectAlbum(msg) {
    const c = await getRedisClient();
    if (!c) return [msg];
    const key = `album:${msg.chat.id}:${msg.media_group_id}`;
    try {
        const position = await c.rPush(key, JSON.stringify(msg));
        await c.expire(key, 60);
        await new Promise(resolve => setTimeout(resolve, ALBUM_WAIT_MS));
        if (await c.lLen(key) > position) return null;
        const [items] = await c.multi().lRange(key, 0, -1).del(key).exec();
        if (!items?.length) return null;
        return items.map(item => JSON.parse(item)).sort((a, b) => a.message_id - b.message_id);
    } catch {
        return [msg];
    }
}

export async function clearModelFailed(model) {
    const key = `fail:model:${model}`;
    memoryCache.delete(key);
    const c = await getRedisClient();
    if (!c) return;
    try { await c.del(key); } catch {}
}
