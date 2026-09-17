/**
 * Static sample content for Milestone 2A. Nothing here is persisted or fetched;
 * it exists so the interface can be reviewed with realistic copy.
 */

export type Conversation = {
  id: string;
  title: string;
};

export type ConversationGroup = {
  label: string;
  conversations: readonly Conversation[];
};

export const CONVERSATION_GROUPS: readonly ConversationGroup[] = [
  {
    label: "Today",
    conversations: [
      { id: "project-ideas", title: "Project ideas" },
      { id: "landing-copy", title: "Landing page copy review" },
      { id: "roadmap", title: "Q3 roadmap summary" },
    ],
  },
  {
    label: "Yesterday",
    conversations: [
      { id: "auth-flow", title: "Debugging the auth flow" },
      { id: "db-naming", title: "Renaming database columns" },
      { id: "standup", title: "Weekly standup notes" },
    ],
  },
];

export const ACTIVE_CONVERSATION_ID = "project-ideas";
export const ACTIVE_CONVERSATION_TITLE = "Project ideas";

export type AiModel = {
  id: string;
  label: string;
};

export const AI_MODELS: readonly AiModel[] = [
  { id: "gemini", label: "Gemini" },
  { id: "claude", label: "Claude" },
  { id: "gpt", label: "GPT" },
];

export const ACTIVE_MODEL_ID = "claude";

export type AnswerPoint = {
  heading: string;
  body: string;
};

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  intro: string;
  heading: string;
  points: readonly AnswerPoint[];
  closing: string;
};

export type Message = UserMessage | AssistantMessage;

export const MESSAGES: readonly Message[] = [
  {
    id: "m1",
    role: "user",
    text: "I want to build a small side project over the next few weekends. Something I can actually finish. Any suggestions?",
  },
  {
    id: "m2",
    role: "assistant",
    heading: "Three directions worth considering",
    intro:
      "The projects people finish tend to solve a problem they already have, and they store almost no state. Here are three that fit a few weekends:",
    points: [
      {
        heading: "A reading queue that emails you one saved article a day",
        body: "You save links during the week and get a single one back each morning. The whole thing is a database table, a cron job, and one email template — no feed, no algorithm, no app to open.",
      },
      {
        heading: "A receipt scanner for expense reports",
        body: "Photograph a receipt, pull out the vendor, date, and total, and append a row to a spreadsheet. The value is in skipping manual entry, so the interface can stay a single upload button.",
      },
      {
        heading: "A changelog generator for your own repositories",
        body: "Read merged pull requests since the last tag and group them into a readable summary. It runs locally, needs no accounts, and you will use it on the next project you ship.",
      },
    ],
    closing:
      "If you tell me which of these sounds closest, I can sketch the data model and the first weekend's scope.",
  },
];
