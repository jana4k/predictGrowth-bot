import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); // Ensures .env variables are loaded

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("CRITICAL: MONGODB_URI is not defined in environment variables. Database functionality will be disabled.");
}

// Mongoose connection options (Mongoose 6+ has different defaults, some old options are deprecated)
const mongooseOptions = {
    // useNewUrlParser: true, // Deprecated in Mongoose 6+
    // useUnifiedTopology: true, // Deprecated in Mongoose 6+
    // useCreateIndex: true, // Deprecated in Mongoose 6+
    // useFindAndModify: false, // Deprecated in Mongoose 6+
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    retryWrites: true, // This is usually part of the URI but can be set here too
};

let isConnected: boolean = false;

export const connectToDatabase = async (): Promise<void> => {
    if (isConnected) {
        console.log('[DB] Already connected to MongoDB.');
        return;
    }

    if (!MONGODB_URI) {
        console.warn("[DB] MONGODB_URI not set. Skipping database connection.");
        return;
    }

    try {
        console.log('[DB] Attempting to connect to MongoDB Atlas...');
        await mongoose.connect(MONGODB_URI, mongooseOptions);
        isConnected = true;
        console.log('[DB] Successfully connected to MongoDB Atlas.');

        mongoose.connection.on('error', (err) => {
            console.error('[DB] MongoDB connection error after initial connection:', err);
            isConnected = false; // Update status on error
        });

        mongoose.connection.on('disconnected', () => {
            console.log('[DB] MongoDB disconnected.');
            isConnected = false; // Update status on disconnection
        });

        mongoose.connection.on('reconnected', () => {
            console.log('[DB] MongoDB reconnected.');
            isConnected = true; // Update status on reconnection
        });

    } catch (error) {
        console.error('[DB] Error connecting to MongoDB Atlas during initial setup:', error);
        isConnected = false;
        // Depending on the context, you might want to throw the error
        // to prevent the application from starting if DB is critical.
        // For Lambda, you might let it fail and rely on CloudWatch for logs.
        // throw error;
    }
};

// Optional: Helper to ensure connection before an operation.
// This can be useful in Lambda environments where you want to ensure the connection
// is active before each DB operation, handling reconnections if needed.
export const ensureDbConnection = async (): Promise<void> => {
    if (!isConnected && MONGODB_URI) {
        console.log("[DB] Connection lost or not established. Attempting to reconnect...");
        await connectToDatabase();
    } else if (!MONGODB_URI) {
        console.warn("[DB] Cannot ensure DB connection: MONGODB_URI not set.");
    }
};