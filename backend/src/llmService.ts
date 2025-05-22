import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"; // Google AI SDK

// --- Configuration ---
const KNOWLEDGE_BASE_FILE_PATH = path.resolve(__dirname, 'knowledge_base.txt'); // Adjusted for common build structure
const GOOGLE_AI_API_KEY = 'API-KEYs'; // New Google AI API Key
const OPENROUTER_API_KEY = 'API-KEY';
// --- END CRITICAL ---

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Consider a model known for strong JSON mode adherence as default
const DEFAULT_OPENROUTER_MODEL = "google/gemma-3-27b-it:free"; // Or "mistralai/mistral-7b-instruct-v0.2:free"
// BACKUP_OPENROUTER_MODEL is removed as requested
const GOOGLE_AI_MODEL_NAME = "gemini-2.0-flash"; // Or "gemini-pro" // Note: "gemini-2.0-flash" might not exist, "gemini-1.5-flash-latest" or "gemini-pro" are common

// --- Load Knowledge Base ---
let KNOWLEDGE_BASE_CONTENT = '';
try {
    console.log(`[Knowledge Base] Attempting to load from resolved path: ${KNOWLEDGE_BASE_FILE_PATH}`);
    KNOWLEDGE_BASE_CONTENT = fs.readFileSync(KNOWLEDGE_BASE_FILE_PATH, 'utf-8');
    console.log(`[Knowledge Base] Loaded successfully.`);
} catch (error) {
    console.error(`[Knowledge Base] CRITICAL: Failed to load from: ${KNOWLEDGE_BASE_FILE_PATH}. Check path and deployment.`, error);
}

// --- Type Definitions ---
interface LLMTextResponse { type: "text"; answer: string; follow_up?: string | null; }
interface LLMListItem { point: string; detail: string; }
interface LLMListResponse { type: "list"; title: string; items: LLMListItem[]; follow_up?: string | null; }
interface LLMErrorResponse { type: "error"; message: string; }
export type LLMStructuredResponse = LLMTextResponse | LLMListResponse | LLMErrorResponse;

// --- System Prompt (shared between OpenRouter and Google AI) ---
const sharedSystemPromptForJSON = `
You are a specialized AI assistant for startup fundraising queries.
Your answers MUST be based *EXCLUSIVELY* on the DOCUMENT provided in the user's message.
Do not invent information or use external knowledge.
Your entire response MUST be a single, valid JSON object.
Do NOT include ANY conversational preamble, introductory sentences, or any text whatsoever outside the JSON structure itself.
Your response MUST start with '{' and end with '}'.
If the DOCUMENT does not contain information to answer the question, or if you cannot confidently answer based SOLELY on the DOCUMENT,
your *entire* output MUST be exactly this JSON object:
{"type": "text", "answer": "I'm sorry, but I cannot find specific information on that topic within the provided fundraising guide.", "follow_up": null}

Available JSON response structures:

1.  For textual answers:
    {
      "type": "text",
      "answer": "A detailed, concise answer derived from the DOCUMENT.",
      "follow_up": "An optional, relevant follow-up question based on the answer, or null."
    }

2.  For answers best presented as a list (e.g., steps, tips, components):
    {
      "type": "list",
      "title": "A brief, descriptive title for the list.",
      "items": [
        { "point": "Short heading for the first item.", "detail": "Detailed explanation for the first item, from the DOCUMENT." },
        { "point": "Short heading for the second item.", "detail": "Detailed explanation for the second item, from the DOCUMENT." }
      ],
      "follow_up": "An optional, relevant follow-up question, or null."
    }
    Each item in the "items" array MUST be an object with "point" and "detail" string keys.

IMPORTANT FORMATTING RULES FOR JSON STRING VALUES:
- Ensure all string values are properly escaped (e.g., newlines as \\n, quotes as \\").
- DO NOT use Markdown (like **bold** or *italics*).
`;


// --- Main Exported Function - Tries OpenRouter, then Google AI as Fallback ---
export async function getAnswerFromLLM(question: string): Promise<LLMStructuredResponse> {
    const commonChecksResult = commonPreChecks();
    if (commonChecksResult) return commonChecksResult;

    try {
        console.log("[Attempting OpenRouter Primary]");
        // Only one attempt with DEFAULT_OPENROUTER_MODEL
        return await attemptOpenRouter(question, DEFAULT_OPENROUTER_MODEL);
    } catch (openRouterError: any) {
        console.warn(`[OpenRouter Failed with ${DEFAULT_OPENROUTER_MODEL}] Error:`, openRouterError.message);
        if (GOOGLE_AI_API_KEY) {
            console.log("[Attempting Google AI Fallback]");
            try {
                return await getAnswerFromGoogleAI(question);
            } catch (googleAIError: any) {
                console.error("[Google AI Fallback Failed] Error:", googleAIError.message);
                return { type: "error", message: `All AI services failed. Google AI Error: ${googleAIError.message || 'Unknown Google AI Error'} (E:F01)` };
            }
        } else {
            console.error("[Fallback Skipped] GOOGLE_AI_API_KEY not configured.");
            return { type: "error", message: `Primary AI service failed and no fallback configured. OpenRouter Error: ${openRouterError.message || 'Unknown OpenRouter Error'} (E:F02)` };
        }
    }
}

function commonPreChecks(): LLMStructuredResponse | null {
    if (!OPENROUTER_API_KEY && !GOOGLE_AI_API_KEY) {
        console.error("[Service Error] No AI API keys configured (OpenRouter or Google AI).");
        return { type: "error", message: "Critical Error: AI service API key(s) missing. Contact support. (E:CFG00)" };
    }
    const effectiveKnowledgeBase = process.env.KNOWLEDGE_BASE_CONTENT_OVERRIDE || KNOWLEDGE_BASE_CONTENT;
    if (!effectiveKnowledgeBase) {
        console.error("[Service Error] Knowledge base is empty and no override is set.");
        return { type: "error", message: "Critical Error: Knowledge base unavailable. Contact support. (E:CFG02)" };
    }
    return null; // All checks passed
}


// --- OpenRouter Attempt Function ---
// Removed attempt parameter, directly uses the model passed.
async function attemptOpenRouter(question: string, modelToUse: string): Promise<LLMStructuredResponse> {
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured for attemptOpenRouter. (E:OR_CFG)");

    const effectiveKnowledgeBase = process.env.KNOWLEDGE_BASE_CONTENT_OVERRIDE || KNOWLEDGE_BASE_CONTENT;
    const userPromptContent = `DOCUMENT:\n---\n${effectiveKnowledgeBase.substring(0, 25000)}\n---\nUSER QUESTION: ${question}`;

    console.log(`[OpenRouter] Model: ${modelToUse}, Question: "${question.substring(0, 70)}..."`);
    const requestBody = {
        model: modelToUse,
        messages: [
            { role: 'system', content: sharedSystemPromptForJSON },
            { role: 'user', content: userPromptContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2, max_tokens: 2000,
    };

    try {
        const llmApiResponse = await axios.post(OPENROUTER_API_URL, requestBody, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json',
                'HTTP-Referer': process.env.YOUR_SITE_URL || 'http://localhost:3000', // Replace with your actual site URL
                'X-Title': process.env.YOUR_APP_NAME || 'FundraisingQABot-OR', // Replace with your actual app name
            },
            timeout: 75000 // Increased timeout for potentially slower free models
        });
        const rawContent = llmApiResponse.data?.choices?.[0]?.message?.content;
        if (!rawContent || typeof rawContent !== 'string' || rawContent.trim() === "") {
            throw new Error("OpenRouter AI service returned empty or invalid content. (E:OR_LR01)");
        }
        console.log(`[OpenRouter Response] Raw content received (first 300):`, rawContent.substring(0, 300) + "...");
        return parseAndValidateAIResponse(rawContent, "OpenRouter");
    } catch (error) {
        const errorMessage = error instanceof AxiosError && error.response ?
            `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}` :
            (error instanceof Error ? error.message : String(error));
        console.error(`[OpenRouter API Call Error] Model: ${modelToUse}, Error: ${errorMessage}`);
        throw error; // Re-throw to be caught by the main getAnswerFromLLM for fallback
    }
}

// --- Google AI (Gemini) Fallback Function ---
async function getAnswerFromGoogleAI(question: string): Promise<LLMStructuredResponse> {
    if (!GOOGLE_AI_API_KEY) throw new Error("Google AI API key not configured. (E:GA_CFG)");

    const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: GOOGLE_AI_MODEL_NAME,
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 2000, // Match OpenRouter for consistency
        },
        // Safety settings can be adjusted if needed, though default is usually fine
        // safetySettings: [
        //   { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        // ]
    });

    const effectiveKnowledgeBase = process.env.KNOWLEDGE_BASE_CONTENT_OVERRIDE || KNOWLEDGE_BASE_CONTENT;
    const fullPromptForGoogleAI = `
        ${sharedSystemPromptForJSON} 

        DOCUMENT:
        ---
        ${effectiveKnowledgeBase.substring(0, 25000)} 
        ---

        USER QUESTION: ${question}

        JSON RESPONSE (ONLY the JSON object, no other text or markdown):
    `;

    console.log(`[Google AI Request] Model: ${GOOGLE_AI_MODEL_NAME}, Question: "${question.substring(0, 70)}..."`);

    try {
        const result = await model.generateContent(fullPromptForGoogleAI);
        const response = result.response;
        const rawContent = response.text(); // text() is a function that needs to be called

        if (!rawContent || rawContent.trim() === "") {
            console.warn("[Google AI Response] LLM returned empty content. Full response object:", JSON.stringify(response, null, 2));
            throw new Error("Google AI service returned empty content. (E:GA_LR01)");
        }
        console.log("[Google AI Response] Raw content received (first 300):", rawContent.substring(0, 300) + "...");
        return parseAndValidateAIResponse(rawContent, "GoogleAI");
    } catch (error: any) {
        console.error("[Google AI API Call Error]", error.message || error);
        throw new Error(`Google AI service failed: ${error.message || 'Unknown Google AI Error'} (E:GA_AX)`);
    }
}


// --- Dedicated Parsing and Validation Function ---
function parseAndValidateAIResponse(rawContentFromLLM: string, source: string = "LLM"): LLMStructuredResponse {
    console.log(`[ParseValidate from ${source}] Raw content (first 300):`, rawContentFromLLM.substring(0, 300) + "...");
    
    let jsonStringToParse = rawContentFromLLM.trim();

    const markdownMatch = jsonStringToParse.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (markdownMatch && markdownMatch[1]) {
        jsonStringToParse = markdownMatch[1].trim();
        console.log(`[ParseValidate from ${source}] Extracted content from markdown block.`);
    } else if (!(jsonStringToParse.startsWith('{') && jsonStringToParse.endsWith('}'))) {
        console.warn(`[ParseValidate from ${source}] Content doesn't appear to be JSON or markdown-wrapped JSON. Raw start:`, jsonStringToParse.substring(0, 70));
    }
    console.log(`[ParseValidate from ${source}] String to be parsed (first 300):`, jsonStringToParse.substring(0,300) + "...");

    let parsedData: any;
    try {
        parsedData = JSON.parse(jsonStringToParse);
    } catch (parseError: any) {
        console.error(`[ParseValidate from ${source}] JSON.parse failed. Error:`, parseError.message);
        console.error(`[ParseValidate from ${source}] String that failed parsing (full):`, jsonStringToParse); // Log full string on error
        return { type: "error", message: `AI service response from ${source} was not valid JSON. (E:PV01_${source})` };
    }

    if (typeof parsedData !== 'object' || parsedData === null || !parsedData.type) {
        console.warn(`[ParseValidate from ${source}] Parsed data invalid structure (missing type or not an object). Data:`, JSON.stringify(parsedData, null, 2));
        return { type: "error", message: `AI response from ${source} invalid structure. (E:PV02_${source})` };
    }

    if (parsedData.follow_up && typeof parsedData.follow_up === 'string') {
         parsedData.follow_up = removeMarkdownBold(parsedData.follow_up);
    } else if (parsedData.follow_up !== null && parsedData.follow_up !== undefined) { // Handle if follow_up is not string or null
        console.warn(`[ParseValidate from ${source}] 'follow_up' field was not a string or null:`, parsedData.follow_up);
        parsedData.follow_up = null; // Default to null if invalid type
    }


    switch (parsedData.type) {
        case "text":
            if (typeof parsedData.answer !== 'string') {
                console.warn(`[ParseValidate from ${source}] 'text' response missing or invalid 'answer'. Data:`, JSON.stringify(parsedData, null, 2));
                return { type: "error", message: `AI 'text' response from ${source} missing 'answer'. (E:PV03_${source})` };
            }
            parsedData.answer = removeMarkdownBold(parsedData.answer);
            console.log(`[ParseValidate from ${source}] Success as 'text'.`);
            return parsedData as LLMTextResponse;
        case "list":
            if (typeof parsedData.title !== 'string' || !Array.isArray(parsedData.items)) {
                console.warn(`[ParseValidate from ${source}] 'list' response invalid structure. Data:`, JSON.stringify(parsedData, null, 2));
                return { type: "error", message: `AI 'list' response from ${source} invalid. (E:PV04_${source})` };
            }
            parsedData.title = removeMarkdownBold(parsedData.title);
            parsedData.items = (parsedData.items as any[]).map(item => {
                if (typeof item !== 'object' || item === null) {
                    console.warn(`[ParseValidate from ${source}] Invalid item in 'list' response. Item:`, item);
                    return { point: "N/A", detail: "Invalid item structure" };
                }
                return {
                    point: removeMarkdownBold(typeof item.point === 'string' ? item.point : "N/A"),
                    detail: removeMarkdownBold(typeof item.detail === 'string' ? item.detail : "N/A"),
                };
            });
            console.log(`[ParseValidate from ${source}] Success as 'list'.`);
            return parsedData as LLMListResponse;
        case "error":
             if (typeof parsedData.message !== 'string') {
                console.warn(`[ParseValidate from ${source}] AI 'error' response missing or invalid 'message'. Data:`, JSON.stringify(parsedData, null, 2));
                return { type: "error", message: `AI 'error' response from ${source} missing 'message'. (E:PV05_${source})` };
             }
             console.log(`[ParseValidate from ${source}] Success as 'error' (from ${source} LLM). Message: ${parsedData.message}`);
             return parsedData as LLMErrorResponse;
        default:
            console.warn(`[ParseValidate from ${source}] Unknown type: ${parsedData.type}. Data:`, JSON.stringify(parsedData, null, 2));
            return { type: "error", message: `AI from ${source} returned unknown type: '${parsedData.type}'. (E:PV06_${source})` };
    }
}

// Helper to remove markdown bolding
function removeMarkdownBold(text: string): string {
    if (typeof text !== 'string') return '';
    return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
}
