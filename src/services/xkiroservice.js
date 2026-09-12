import OpenAI from "openai";
import { configDotenv } from "dotenv";
import { groq } from "./groqservice.js";
import { mistralChatCompletion, mistralChatModel } from "./mistralservice.js";

configDotenv();

export const model = "qwen/qwen3-max:free";
const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";

const FALLBACK_MODELS = [
    "qwen/qwen3-max:free"
];

export const xkiro = new OpenAI({ baseURL: "https://api.xkiro.com/v1", apiKey: process.env.XKIRO });

export async function chatCompletion(params) {
    let lastErr;
    for (const fallbackModel of FALLBACK_MODELS) {
        try {
            return await xkiro.chat.completions.create({ ...params, model: fallbackModel });
        } catch (err) {
            console.log(`xkiro model ${fallbackModel} failed:`, err.message);
            lastErr = err;
        }
    }
    try {
        console.log("xkiro all models failed, falling back to Groq");
        return await groq.chat.completions.create({ ...params, model: GROQ_FALLBACK_MODEL });
    } catch (err) {
        console.log(`groq model ${GROQ_FALLBACK_MODEL} failed:`, err.message);
        lastErr = err;
    }
    if (process.env.MISTRAL) {
        try {
            console.log("groq failed, falling back to Mistral");
            return await mistralChatCompletion(params);
        } catch (err) {
            console.log(`mistral model ${mistralChatModel} failed:`, err.message);
            lastErr = err;
        }
    }
    throw lastErr;
}
