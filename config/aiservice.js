import Groq from "groq-sdk";
import { configDotenv } from "dotenv";
import { HfInference } from "@huggingface/inference";

configDotenv();

export const groq = new Groq({ apiKey: process.env.AI });

export const hf = new HfInference(process.env.HF);

