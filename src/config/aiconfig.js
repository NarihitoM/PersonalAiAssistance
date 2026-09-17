import { config } from "dotenv";
config();
import OpenAI from "openai";
import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";

export const modelaudio = "canopylabs/orpheus-v1-english";
export const transcriptmodel = "whisper-large-v3-turbo";
export const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";
export const mistralChatModel = "mistral-small-latest";

export const FALLBACK_MODELS = [
    "qwen/qwen3.8-max:free",
    "qwen/qwen3-max:free",
    "qwen/qwen3.7-flash:free",
    "qwen/qwen3.5-plus:free",
    "minimax/minimax-m3:free",
    "mistralai/mistral-medium-3.5",
    "mistralai/mistral-small-2603",
    "sensenova/sensenova-6.8-flash-lite"
];

export const UNO_FALLBACK_MODELS = [
    "mistral-large-3-675b:free",
    "gemini-3.6-flash:free"
];

export const groq = new Groq({ apiKey: process.env.AI });
export const mistral = new Mistral({ apiKey: process.env.MISTRAL });
export const xkiro = new OpenAI({ baseURL: "https://api.xkiro.com/v1", apiKey: process.env.XKIRO });
export const uno = new OpenAI({ baseURL: "https://api.unorouter.com/v1", apiKey: process.env.UNO });
