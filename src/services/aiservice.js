import OpenAI from "openai";
import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import { config } from "dotenv";
import { geminiChatCompletion, geminiChatModel } from "./geminiservice.js";
import { isModelFailed, markModelFailed, clearModelFailed } from "./rediscache.js";

config();

export const modelaudio = "canopylabs/orpheus-v1-english";
export const transcriptmodel = "whisper-large-v3-turbo";

export const groq = new Groq({ apiKey: process.env.AI });

export const mistralChatModel = "mistral-small-latest";
export const mistral = new Mistral({ apiKey: process.env.MISTRAL });

export async function mistralChatCompletion({ tools, messages }) {
    const res = await mistral.chat.complete({
        model: mistralChatModel,
        messages,
        tools,
        toolChoice: "auto"
    });

    const choice = res.choices[0];
    const msg = choice.message;

    return {
        choices: [{
            message: {
                role: msg.role,
                content: typeof msg.content === "string" ? msg.content : "",
                tool_calls: (msg.toolCalls || []).map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === "string"
                            ? tc.function.arguments
                            : JSON.stringify(tc.function.arguments)
                    }
                }))
            },
            finish_reason: choice.finishReason
        }]
    };
}

export const model = "qwen/qwen3.8-max:free";
const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";

const FALLBACK_MODELS = [
    "qwen/qwen3.8-max:free",
    "qwen/qwen3-max:free",
    "qwen/qwen3.7-flash:free",
    "qwen/qwen3.5-plus:free",
    "minimax/minimax-m3:free",
    "mistralai/mistral-medium-3.5",
    "mistralai/mistral-small-2603",
    "sensenova/sensenova-6.8-flash-lite"
];

export const xkiro = new OpenAI({ baseURL: "https://api.xkiro.com/v1", apiKey: process.env.XKIRO });

const UNO_FALLBACK_MODELS = [
    "mistral-large-3-675b:free",
    "gemini-3.6-flash:free"
];
export const uno = new OpenAI({ baseURL: "https://api.unorouter.com/v1", apiKey: process.env.UNO });

export async function chatCompletion(params) {
    let lastErr;
    for (const fallbackModel of FALLBACK_MODELS) {
        if (await isModelFailed(fallbackModel)) {
            console.log(`skip cached failed xkiro ${fallbackModel}`);
            continue;
        }
        try {
            const res = await xkiro.chat.completions.create({ ...params, model: fallbackModel });
            await clearModelFailed(fallbackModel);
            return res;
        } catch (err) {
            console.log(`xkiro model ${fallbackModel} failed:`, err.message);
            await markModelFailed(fallbackModel);
            lastErr = err;
        }
    }
    for (const unoModel of UNO_FALLBACK_MODELS) {
        if (await isModelFailed(unoModel)) {
            console.log(`skip cached failed uno ${unoModel}`);
            continue;
        }
        try {
            console.log(`xkiro all models failed, trying Uno ${unoModel}`);
            const res = await uno.chat.completions.create({ ...params, model: unoModel });
            await clearModelFailed(unoModel);
            return res;
        } catch (err) {
            console.log(`uno model ${unoModel} failed:`, err.message);
            await markModelFailed(unoModel);
            lastErr = err;
        }
    }
    if (await isModelFailed(GROQ_FALLBACK_MODEL)) {
        console.log(`skip cached failed groq ${GROQ_FALLBACK_MODEL}`);
    } else {
        try {
            console.log("uno all models failed, falling back to Groq");
            const res = await groq.chat.completions.create({ ...params, model: GROQ_FALLBACK_MODEL });
            await clearModelFailed(GROQ_FALLBACK_MODEL);
            return res;
        } catch (err) {
            console.log(`groq model ${GROQ_FALLBACK_MODEL} failed:`, err.message);
            await markModelFailed(GROQ_FALLBACK_MODEL);
            lastErr = err;
        }
    }
    if (process.env.GEMINI) {
        if (await isModelFailed(geminiChatModel)) {
            console.log(`skip cached failed gemini ${geminiChatModel}`);
        } else {
            try {
                console.log("groq failed, falling back to Gemini");
                const res = await geminiChatCompletion(params);
                await clearModelFailed(geminiChatModel);
                return res;
            } catch (err) {
                console.log(`gemini model ${geminiChatModel} failed:`, err.message);
                await markModelFailed(geminiChatModel);
                lastErr = err;
            }
        }
    }
    if (process.env.MISTRAL) {
        if (await isModelFailed(mistralChatModel)) {
            console.log(`skip cached failed mistral ${mistralChatModel}`);
        } else {
            try {
                console.log("gemini failed, falling back to Mistral");
                const res = await mistralChatCompletion(params);
                await clearModelFailed(mistralChatModel);
                return res;
            } catch (err) {
                console.log(`mistral model ${mistralChatModel} failed:`, err.message);
                await markModelFailed(mistralChatModel);
                lastErr = err;
            }
        }
    }
    throw lastErr;
}
