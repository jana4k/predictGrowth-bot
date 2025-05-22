// frontend/src/App.tsx
// React import is often not needed with modern JSX transform
import { ConfigProvider, Layout, Typography } from 'antd'; // Removed unused 'theme as antdTheme'
import ChatInterface from './components/ChatInterface';
import {
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/clerk-react';
// Removed: import { useNavigate, Routes, Route, Link } from 'react-router-dom';

const { Header, Content } = Layout;
const { Title } = Typography;

const clerkPubKey = 'pk_test_bWVldC1ib2EtNjEuY2xlcmsuYWNjb3VudHMuZGV2JA';

if (!clerkPubKey) {
  throw new Error("Missing Clerk Publishable Key. Did you set VITE_CLERK_PUBLISHABLE_KEY in .env.local?");
}

function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      // No navigate prop needed if not using react-router-dom for Clerk's navigation
    >
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1677ff',
          },
        }}
      >
        <Layout className="min-h-screen">
          <Header className="flex items-center justify-between bg-white shadow px-6">
            <Title level={3} className="!mb-0 text-blue-600">
              Fundraising Q&A Bot
            </Title>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </Header>
          <Content className="p-0 flex items-center justify-center">
            <SignedIn>
              <ChatInterface />
            </SignedIn>
            <SignedOut>
              <div className="text-center p-10 max-w-md mx-auto"> {/* Added max-width for better centering */}
                <Title level={2}>Welcome!</Title>
                <p className="mb-6 text-lg">Please sign in to ask questions about startup fundraising.</p>
                <SignIn
                  // For the simplest setup without full react-router-dom integration for these pages,
                  // Clerk's default modal or redirect behavior might be preferred.
                  // If using paths, ensure your hosting (like Vercel) can handle client-side routing for /sign-in and /sign-up.
                  // routing="path" // Using path routing assumes you have routes defined for these or rely on Clerk to manage them
                  // path="/sign-in"
                  // signUpUrl="/sign-up"
                  afterSignInUrl="/"
                  afterSignUpUrl="/"
                  // For non-path routing (modal/redirects), you might not need 'path' and 'routing' here.
                  // Or, use routing="hash" if you prefer hash-based navigation for these Clerk UIs.
                />
              </div>
            </SignedOut>
          </Content>
        </Layout>
      </ConfigProvider>
    </ClerkProvider>
  );
}

export default App;