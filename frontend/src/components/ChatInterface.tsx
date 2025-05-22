import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, List, Avatar, Spin, Alert, Card, Typography, Tag, Drawer, Empty, Divider } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined, LoadingOutlined, QuestionCircleOutlined, InfoCircleOutlined, ExclamationCircleFilled, HistoryOutlined, CloseOutlined } from '@ant-design/icons';
import axios, { AxiosError } from 'axios';
import { useAuth } from "@clerk/clerk-react";

const { TextArea } = Input;
const { Text, Paragraph, Title } = Typography; // Removed AntLink as it was unused

// --- Type Definitions (MUST match backend EXACTLY for LLM responses) ---
interface LLMBaseResponse {
    follow_up?: string | null;
    source_section_id?: string | null;
    source_section_title?: string | null;
}

interface LLMTextResponse extends LLMBaseResponse {
    type: "text";
    answer: string;
}

interface LLMListItem {
    point: string;
    detail: string;
}
interface LLMListResponse extends LLMBaseResponse {
    type: "list";
    title: string;
    items: LLMListItem[];
}

interface LLMErrorResponse {
    type: "error";
    message: string;
}

type LLMStructuredResponse = LLMTextResponse | LLMListResponse | LLMErrorResponse;

interface Message {
  id: string;
  sender: 'user' | 'bot';
  content: LLMStructuredResponse | string;
  isProcessing?: boolean;
}

interface QAHistoryItem {
    _id: string;
    userId: string; // userId from Clerk was declared but not used in ChatInterface, keeping it here as it's part of the data model
    question: string;
    llmResponse: LLMStructuredResponse;
    timestamp: string;
}
// --- End Type Definitions ---

const ChatInterface: React.FC = () => {
  const [question, setQuestion] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const { getToken, isSignedIn } = useAuth(); // Removed userId as it was unused in this component directly
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<QAHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const backendUrl = 'https://3005-firebase-predictgrowth-1747803817750.cluster-zumahodzirciuujpqvsniawo3o.cloudworkstations.dev/api';

  useEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (chatContainerRef.current && messages.length > 0) {
        const timer = setTimeout(() => {
            if (chatContainerRef.current) {
                 chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
        }, 100);
        return () => clearTimeout(timer);
    }
  }, [messages]);

  const handleExampleQuestionClick = (q: string) => {
    setQuestion(q);
    const inputElement = document.querySelector('textarea');
    if (inputElement) inputElement.focus();
  };

  const handleSubmit = async () => {
    if (!question.trim() || !isSignedIn) {
        if (!isSignedIn) setGlobalError("You must be signed in to ask questions.");
        return;
    }

    const userMessage: Message = { id: Date.now().toString() + '-user', content: question, sender: 'user' };
    const botTypingMessageId = Date.now().toString() + '-bot-typing';
    const botTypingMessage: Message = {
        id: botTypingMessageId,
        content: {type: "text", answer: ""} ,
        sender: 'bot',
        isProcessing: true
    };

    setMessages(prev => [...prev, userMessage, botTypingMessage]);
    setIsSending(true);
    setGlobalError(null);
    const currentQuestion = question;
    setQuestion('');

    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication error: Token unavailable. Please sign in again.");

      const response = await axios.post<LLMStructuredResponse>(
        `${backendUrl}/ask`,
        { question: currentQuestion },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data && typeof response.data === 'object' && response.data.hasOwnProperty('type')) {
        setMessages(prev => prev.map(msg =>
          msg.id === botTypingMessageId
            ? { ...msg, content: response.data, isProcessing: false }
            : msg
        ));
      } else {
        console.error("[Frontend Error] Backend returned unexpected data structure. Full response:", response);
        throw new Error(`Received an improperly formatted response from the server. (FE01)`);
      }
    } catch (err: any) {
      console.error("[Frontend Error] Error in handleSubmit:", err.isAxiosError ? err.toJSON() : err);
      let errorMessage = 'An unexpected error occurred. Please try again. (FE02)';
      if (err.message?.startsWith("Authentication error:") || err.message?.startsWith("Received an improperly formatted response")) {
          errorMessage = err.message;
      } else if (axios.isAxiosError(err as AxiosError)) {
        const axiosError = err as AxiosError<any>;
        if (axiosError.response) {
          if (axiosError.response.data?.type === 'error' && axiosError.response.data.message) {
            errorMessage = axiosError.response.data.message;
          } else if (axiosError.response.status === 401 || axiosError.response.status === 403) {
            errorMessage = "Authentication failed. Please sign in again. (FE_AX401/403)";
          } else {
            errorMessage = `Server error (${axiosError.response.status}). Please try again. (FE_AX${axiosError.response.status})`;
          }
        } else if (axiosError.request) {
          errorMessage = "Cannot reach server. Check your internet connection or if the backend is running. (FE_AXREQ)";
        }
      }
      setGlobalError(errorMessage);
      setMessages(prev => prev.map(msg =>
        msg.id === botTypingMessageId
          ? { ...msg, content: { type: "error", message: errorMessage } as LLMErrorResponse, isProcessing: false }
          : msg
      ));
    } finally {
      setIsSending(false);
    }
  };

  const fetchHistory = useCallback(async () => {
    if (!isSignedIn) {
        setHistoryError("Please sign in to view history.");
        return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
        const token = await getToken();
        if (!token) throw new Error("Authentication token not available.");

        const response = await axios.get<QAHistoryItem[]>(`${backendUrl}/history`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        setHistoryItems(response.data);
    } catch (err) {
        console.error("Error fetching history:", err);
        let msg = "Failed to load history.";
        if (axios.isAxiosError(err) && (err as AxiosError<any>).response?.data?.message) { // Type assertion
            msg = (err as AxiosError<any>).response!.data.message;
        }
        setHistoryError(msg);
    } finally {
        setHistoryLoading(false);
    }
  }, [isSignedIn, getToken, backendUrl]);


  const showHistoryDrawer = () => {
    setHistoryDrawerVisible(true);
    fetchHistory();
  };

  const closeHistoryDrawer = () => {
    setHistoryDrawerVisible(false);
  };

  const renderBotMessageContent = (content: LLMStructuredResponse) => {
    const renderSource = (sourceTitle?: string | null) => {
        if (sourceTitle) {
            return (
                <Text italic type="secondary" className="block mt-2 text-xs">
                    (Source: {sourceTitle})
                </Text>
            );
        }
        return null;
    };

    switch (content.type) {
        case "text":
            return (
                <>
                    <Paragraph className="whitespace-pre-wrap my-1">{content.answer || "No answer text provided."}</Paragraph>
                    {content.follow_up && <Text italic type="secondary" className="block mt-1 text-sm">{content.follow_up}</Text>}
                    {renderSource(content.source_section_title)}
                </>
            );
        case "list":
            return (
                <div className="space-y-1">
                    <Title level={5} className="!mb-1.5 !mt-0">{content.title || "List"}</Title>
                    {content.items && content.items.length > 0 ? (
                        <List
                            size="small"
                            dataSource={content.items}
                            renderItem={(item, index) => (
                                <List.Item key={index} className="!py-0.5 !px-0 border-none">
                                    <List.Item.Meta
                                        avatar={<InfoCircleOutlined className="text-blue-500 mt-0.5" />}
                                        title={<Text strong className="text-sm">{item.point || "N/A"}</Text>}
                                        description={<Paragraph className="!mb-0 whitespace-pre-wrap text-xs">{item.detail || "No detail."}</Paragraph>}
                                    />
                                </List.Item>
                            )}
                            className="bg-gray-50 p-2 rounded-md"
                        />
                    ) : <Paragraph type="secondary" className="text-xs">This list is empty.</Paragraph>}
                    {content.follow_up && <Text italic type="secondary" className="block mt-1 text-sm">{content.follow_up}</Text>}
                    {renderSource(content.source_section_title)}
                </div>
            );
        case "error":
             return (
                <div className="flex items-center">
                    <ExclamationCircleFilled className="text-red-500 mr-2 shrink-0" />
                    <Paragraph className="text-red-600 whitespace-pre-wrap my-1 !mb-0">{content.message || "An unknown error occurred."}</Paragraph>
                </div>
            );
        default:
            // @ts-expect-error content might be an unexpected type if logic error
            const unknownType = content?.type;
            console.warn("renderBotMessageContent: Encountered unknown bot message content type:", unknownType, "Full content:", content);
            return <Paragraph className="whitespace-pre-wrap my-1 text-orange-600">Received content in an unexpected format (type: {unknownType === undefined ? "undefined" : String(unknownType)}).</Paragraph>;
    }
  };

  const exampleQuestions: string[] = [ // Explicitly typed as string[]
    "What is a pre-seed funding round?",
    "When should a startup raise a seed round?",
    "What goes into a pitch deck?",
    "What are SAFEs?",
    "Give me some tips for fundraising.",
    "What is a down round?",
    "What if my dog ate my homework?",
  ];

  return (
    <div className="w-full max-w-3xl mx-auto p-4 md:p-6 h-[calc(100vh-80px)] flex flex-col">
      <Card
        title={<Title level={3} className="text-center !mb-0">Fundraising Q&A Bot</Title>}
        extra={isSignedIn && <Button icon={<HistoryOutlined />} onClick={showHistoryDrawer}>History</Button>}
        className="flex-grow flex flex-col shadow-xl overflow-hidden"
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}
      >
        <div ref={chatContainerRef} className="flex-grow overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.length === 0 && !isSending && (
            <div className="text-center text-gray-500 py-10 flex flex-col items-center justify-center h-full">
                 <QuestionCircleOutlined style={{ fontSize: '48px', color: '#9ca3af' }} className="mb-4" />
                 <Title level={4} className="text-gray-700">Ask about the fundraising guide!</Title>
                 <Paragraph type="secondary" className="mb-2">For example:</Paragraph>
                 <div className="flex flex-wrap justify-center gap-2 px-4">
                {exampleQuestions.map(q => ( // exampleQuestions is now string[]
                    <Tag key={q} onClick={() => handleExampleQuestionClick(q)} className="cursor-pointer hover:bg-blue-100 m-1" color="geekblue">{q}</Tag>
                ))}
              </div>
            </div>
          )}
          {messages.map((item, index) => {
            const isLastMessage = index === messages.length - 1;
             if (item.sender === 'user') {
              return (
                <div key={item.id} ref={isLastMessage ? lastMessageRef : null} className="flex items-end gap-2.5 justify-end">
                  <div className="max-w-[75%] p-3 rounded-xl shadow-sm bg-blue-500 text-white rounded-br-none">
                    <Text className="text-white whitespace-pre-wrap">{item.content as string}</Text>
                  </div>
                  <Avatar icon={<UserOutlined />} className="bg-gray-300 self-start shrink-0 !flex !items-center !justify-center" />
                </div>
              );
            } else {
              return (
                <div key={item.id} ref={isLastMessage ? lastMessageRef : null} className="flex items-start gap-2.5 justify-start">
                  <Avatar icon={<RobotOutlined />} className="bg-blue-500 self-start shrink-0 !flex !items-center !justify-center mt-1" />
                  <div className={`max-w-[75%] p-3 rounded-xl shadow-sm ${(item.content as LLMStructuredResponse)?.type === "error" ? 'bg-red-50 text-red-700 rounded-bl-none border border-red-200' : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'}`}>
                    {item.isProcessing ? <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} /> : renderBotMessageContent(item.content as LLMStructuredResponse)}
                  </div>
                </div>
              );
            }
          })}
        </div>

        <div className="p-4 border-t bg-white shrink-0">
          {globalError && !isSending && <Alert message={globalError} type="error" showIcon className="mb-3" closable onClose={() => setGlobalError(null)} />}
          <div className="flex items-center gap-2">
            <TextArea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={isSignedIn ? "Type your question here..." : "Please sign in to ask questions."} autoSize={{ minRows: 1, maxRows: 4 }} onPressEnter={(e) => {if (!e.shiftKey && !isSending && isSignedIn) {e.preventDefault(); handleSubmit();}}} disabled={isSending || !isSignedIn} className="flex-grow"/>
            <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit} loading={isSending} disabled={!question.trim() || isSending || !isSignedIn} size="large">Send</Button>
          </div>
          <Text type="secondary" className="text-xs mt-2 block text-center">Answers based on the "Raise Millions" guide.</Text>
        </div>
      </Card>

      <Drawer
        title="Q&A History"
        placement="right"
        closable={true}
        onClose={closeHistoryDrawer}
        open={historyDrawerVisible}
        width={400}
        closeIcon={<CloseOutlined />}
        extra={<Button icon={<HistoryOutlined />} onClick={fetchHistory} loading={historyLoading}>Refresh</Button>}
      >
        {historyLoading && <div className="text-center p-10"><Spin size="large" /></div>}
        {historyError && <Alert message={historyError} type="error" showIcon className="m-4" />}
        {!historyLoading && !historyError && historyItems.length === 0 && (
            <Empty description="No history found." className="mt-10" />
        )}
        {!historyLoading && !historyError && historyItems.length > 0 && (
            <List
                className="p-4"
                itemLayout="vertical"
                dataSource={historyItems}
                renderItem={(item: QAHistoryItem) => (
                    <List.Item key={item._id} className="mb-3 p-3 border rounded-md shadow-sm bg-white hover:shadow-md transition-shadow">
                        <Title level={5} className="!text-sm !mb-1 text-blue-600">You asked:</Title>
                        <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: 'more' }} className="text-gray-700 text-sm mb-2">
                            {item.question}
                        </Paragraph>
                        <Divider className="my-2" />
                        <Title level={5} className="!text-sm !mb-1 text-green-600">Bot replied:</Title>
                        <div className="text-sm bg-gray-50 p-2 rounded">
                           {renderBotMessageContent(item.llmResponse)}
                        </div>
                        <Text type="secondary" className="text-xs block mt-2 text-right">
                            {new Date(item.timestamp).toLocaleString()}
                        </Text>
                    </List.Item>
                )}
            />
        )}
      </Drawer>
    </div>
  );
};

export default ChatInterface;