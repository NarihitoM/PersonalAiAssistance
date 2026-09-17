import { config } from "dotenv";
config();
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export const gemini = new GoogleGenerativeAI(process.env.GEMINI);
export const visionmodel = gemini.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
export const geminiChatModel = "gemini-2.5-flash";
export const geminiOpenAI = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI
});
