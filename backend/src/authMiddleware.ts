import { ClerkExpressRequireAuth, StrictAuthProp } from '@clerk/clerk-sdk-node'; // Import StrictAuthProp
import { Request } from 'express'; // Use your project's Request type

// This makes Clerk's auth object available on req.auth
// You'll need to augment the Express Request type if you want strong typing for req.auth
// For now, you can access it as (req as any).auth or req.auth if you've augmented Request

declare global {
  namespace Express {
    interface Request extends StrictAuthProp {}
  }
}


// Export Clerk's middleware directly. It will handle its own type requirements.
// You can pass options directly here if needed.
export const requireAuth = ClerkExpressRequireAuth({
    // onError: (err) => {
    //   console.error('Clerk authentication error in requireAuth:', err);
    //   // Clerk usually handles sending the 401/403 for auth failures
    // },
    // onUnauthenticated: (req, res) => {
    //   res.status(401).json({ type: "error", message: "Unauthenticated."});
    // }
});