import mongoose, { Schema, Document } from 'mongoose';

// Define the structure of the LLM response you're storing
// This should match your LLMStructuredResponse from llmService.ts
// For simplicity, we'll use Schema.Types.Mixed, but you could define sub-schemas.
interface ILLMResponseData {
    type: "text" | "list" | "error";
    answer?: string;
    title?: string;
    items?: { point: string; detail: string }[];
    message?: string; // For error type
    follow_up?: string | null;
    source_section_id?: string | null;
    source_section_title?: string | null;
}

export interface IQAHistory extends Document {
    userId: string;
    question: string;
    llmResponse: ILLMResponseData; // Store the full structured LLM response
    timestamp: Date;
}

const QAHistorySchema: Schema<IQAHistory> = new Schema({
    userId: {
        type: String,
        required: true,
        index: true, // Index for faster queries by userId
    },
    question: {
        type: String,
        required: true,
    },
    llmResponse: {
        type: Schema.Types.Mixed, // Allows storing any valid JSON structure
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true, // Index for sorting by time
    },
});

// Optional: TTL index to automatically delete documents after some time (e.g., 90 days)
// Ensure TTL is enabled on your Atlas cluster for this collection if you use it.
// QAHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });


// The third argument is the collection name. Mongoose typically pluralizes the model name.
// If you want 'qaHistories', Mongoose will do that by default.
// If you want 'qa_history_collection', specify it:
// export default mongoose.model<IQAHistory>('QAHistory', QAHistorySchema, 'qa_histories_collection_name');
export default mongoose.model<IQAHistory>('QAHistory', QAHistorySchema);