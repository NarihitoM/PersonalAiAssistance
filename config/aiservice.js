import Groq from "groq-sdk";
import { configDotenv } from "dotenv";
import { GoogleGenAI } from "@google/genai";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

export const Gemini = new GoogleGenAI({apiKey : process.env.GEMINI});

