import { Mistral } from "@mistralai/mistralai";
import { configDotenv } from "dotenv";

configDotenv();

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
