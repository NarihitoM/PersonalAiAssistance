import { createClient } from "redis";
import { config } from "dotenv";
config();

let client = null;
let clientReady = false;

export function isRedisConfigured() {
    const url = process.env.REDIS_URL;
    return Boolean(url && !url.startsWith("https://"));
}

export async function getRedisClient() {
    const url = process.env.REDIS_URL;
    if (!url || url.startsWith("https://")) return null;
    if (client && clientReady) return client;
    try {
        client = createClient({ url });
        client.on("error", () => {});
        await client.connect();
        clientReady = true;
        return client;
    } catch {
        return null;
    }
}
