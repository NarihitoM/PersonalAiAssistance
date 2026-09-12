import OpenAI from "openai";
import { configDotenv } from "dotenv";
import { groq } from "./groqservice.js";

configDotenv();

export const model = "qwen/qwen3-max:free";
const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";

const FALLBACK_MODELS = [
    "qwen/qwen3-max:free",
    "qwen/qwen3.5-plus:free",
    "minimax/minimax-m2:free",
    "minimax/minimax-m3:free",
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash"
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
        throw err;
    }
}
