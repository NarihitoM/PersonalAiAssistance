import Groq from "groq-sdk";
import { configDotenv } from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAI } from "@google/generative-ai";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

export const Gemini = new GoogleGenAI({apiKey : process.env.GEMINI});

export const GeminiImage = new GoogleGenerativeAI({apiKey : process.env.GEMINI});

