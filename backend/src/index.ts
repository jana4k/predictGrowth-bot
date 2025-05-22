import express, { Request, Response, NextFunction, ErrorRequestHandler, RequestHandler } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { getAnswerFromLLM, LLMStructuredResponse } from './llmService';
import { requireAuth }  from './authMiddleware';
import { connectToDatabase, ensureDbConnection } from './db';
import QAHistoryModel, { IQAHistory } from './models/qaHistory.model';

dotenv.config();

const app = express();
const port = process.env.PORT || 3005;

if (process.env.NODE_ENV !== 'test' && !process.env.IS_OFFLINE && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
    connectToDatabase().catch(err => {
        console.error("FATAL: Initial database connection failed. Exiting.", err);
        // process.exit(1); // Consider uncommenting for critical DB dependency
    });
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post(
    '/api/ask',
    requireAuth as unknown as RequestHandler, // Double casting for Clerk middleware type
    async (req: Request, res: Response, next: NextFunction): Promise<void> => { // Explicitly return Promise<void>
        const { question } = req.body;
        const userId = req.auth?.userId;

        if (!question || typeof question !== 'string' || question.trim() === "") {
            // No need to return the res.status().json() call, it sends the response and finishes.
            res.status(400).json({
                type: "error",
                message: 'Question is required and must be a non-empty string.'
            } as LLMStructuredResponse);
            return; // Ensure function exits
        }

        try {
            await ensureDbConnection();

            console.log(`[API /ask] Received question from user ${userId || 'unknown'}: "${question.substring(0,100)}..."`);
            const llmResponse: LLMStructuredResponse = await getAnswerFromLLM(question);
            
            console.log(`[API /ask] LLM service response:`, JSON.stringify(llmResponse).substring(0,500) + "...");

            if (userId && (llmResponse.type === 'text' || llmResponse.type === 'list')) {
                try {
                    const historyEntry = new QAHistoryModel({
                        userId: userId,
                        question: question,
                        llmResponse: llmResponse,
                    });
                    await historyEntry.save();
                    console.log(`[DB] Saved Q&A history for user ${userId}`);
                } catch (dbError: any) {
                    console.error(`[DB] Failed to save Q&A history for user ${userId}:`, dbError.message);
                }
            } else if (userId && llmResponse.type === 'error') {
                 console.log(`[DB] LLM returned an error, not saving interaction for user ${userId}. Error: ${llmResponse.message}`);
            }

            res.status(200).json(llmResponse);
            // No explicit return needed here, res.json() ends the request-response cycle for this path.
        } catch (error: any) {
            console.error(`[API /ask] Error processing question for user ${userId || 'unknown'}:`, error.message);
            next(error); // Pass error to global error handler
        }
    }
);

app.get(
    '/api/history',
    requireAuth as unknown as RequestHandler, // Double casting
    async (req: Request, res: Response, next: NextFunction): Promise<void> => { // Explicitly return Promise<void>
        const userId = req.auth?.userId;

        // requireAuth should handle unauthenticated cases, but this is a safeguard.
        if (!userId) {
            res.status(401).json({ type: "error", message: "User not authenticated." } as LLMStructuredResponse);
            return;
        }

        try {
            await ensureDbConnection();

            console.log(`[API /history] Fetching history for user ${userId}`);
            const historyItems: IQAHistory[] = await QAHistoryModel.find({ userId: userId })
                                               .sort({ timestamp: -1 })
                                               .limit(20);

            res.status(200).json(historyItems);
        } catch (error: any) {
            console.error(`[API /history] Error fetching history for user ${userId}:`, error.message);
            next(error);
        }
    }
);

const globalErrorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("[Global Error Handler] Caught:", err.status, err.message, err.stack?.substring(0,200));
    
    const statusCode = err.statusCode || err.status || 500;
    let errorMessage = err.message || "Internal Server Error";

    if (err.clerkError || (err.status && (err.status === 401 || err.status === 403))) {
        errorMessage = `Authentication Error: ${err.message || 'Please check credentials.'} (E:CLK${statusCode})`;
        if (Array.isArray(err.errors) && err.errors.length > 0) {
            const clerkMessages = err.errors.map((e: any) => e.longMessage || e.message).join(', ');
            errorMessage = `Authentication Error: ${clerkMessages} (E:CLK_DET${statusCode})`;
        }
    }
    // Ensure response is sent only once. If headersSent, defer to Express default handler.
    if (res.headersSent) {
        return next(err);
    }
    res.status(statusCode).json({
        type: "error",
        message: errorMessage
    } as LLMStructuredResponse);
};
app.use(globalErrorHandler);

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    app.listen(port, () => {
        console.log(`Backend server listening at http://localhost:${port}`);
        if (!process.env.MONGODB_URI) {
            console.warn("Warning: MONGODB_URI is not set. Database features will be disabled.");
        }
        if (!process.env.OPENROUTER_API_KEY) {
            console.warn("Warning: OPENROUTER_API_KEY is not set in .env file.");
        }
        if (!process.env.GOOGLE_AI_API_KEY) {
             console.warn("Warning: GOOGLE_AI_API_KEY is not set (for fallback).");
        }
        if (!process.env.CLERK_SECRET_KEY) {
            console.warn("Warning: CLERK_SECRET_KEY is not set in .env file.");
        }
    });
}

// For AWS Lambda using serverless-http if this is serverless.ts
// import serverless from 'serverless-http';
// export const handler = serverless(app);