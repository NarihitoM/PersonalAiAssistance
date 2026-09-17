import { geminiChatCompletion, geminiChatModel } from "./geminiservice.js";
import { isModelFailed, markModelFailed, clearModelFailed } from "./rediscache.js";
import { groq, mistral, xkiro, uno, FALLBACK_MODELS, UNO_FALLBACK_MODELS, GROQ_FALLBACK_MODEL, mistralChatModel, modelaudio, transcriptmodel } from "../config/aiconfig.js";

export { modelaudio, transcriptmodel, groq, mistral, mistralChatModel, xkiro, uno, FALLBACK_MODELS, UNO_FALLBACK_MODELS, GROQ_FALLBACK_MODEL };
export const model = FALLBACK_MODELS[0];

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
