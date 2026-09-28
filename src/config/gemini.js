import { config } from "dotenv";
config();
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export const gemini = new GoogleGenerativeAI(process.env.GEMINI);
export const visionModels = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"]
    .map(model => ({ name: model, client: gemini.getGenerativeModel({ model }) }));
export const geminiChatModel = "gemini-2.5-flash";
export const geminiOpenAI = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI
});
