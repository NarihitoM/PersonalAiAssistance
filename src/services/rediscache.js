import { configDotenv } from "dotenv";
configDotenv();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const FAIL_TTL_SECONDS = 600;
const memoryCache = new Map();

function isUpstashConfigured() {
    return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function upstashFetch(path, options = {}) {
    if (!isUpstashConfigured()) return null;
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${UPSTASH_URL}${path}`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
            signal: controller.signal,
            ...options
        });
        clearTimeout(t);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function isModelFailed(model) {
    const key = `fail:model:${model}`;
    const mem = memoryCache.get(key);
    if (mem && mem > Date.now()) return true;
    if (mem && mem <= Date.now()) memoryCache.delete(key);
    if (!isUpstashConfigured()) return false;
    const data = await upstashFetch(`/get/${encodeURIComponent(key)}`);
    return Boolean(data?.result);
}

export async function markModelFailed(model) {
    const key = `fail:model:${model}`;
    memoryCache.set(key, Date.now() + FAIL_TTL_SECONDS * 1000);
    if (!isUpstashConfigured()) return;
    await upstashFetch(`/set/${encodeURIComponent(key)}/1/EX/${FAIL_TTL_SECONDS}`, { method: "POST" });
}

export async function clearModelFailed(model) {
    const key = `fail:model:${model}`;
    memoryCache.delete(key);
    if (!isUpstashConfigured()) return;
    await upstashFetch(`/del/${encodeURIComponent(key)}`, { method: "POST" });
}
