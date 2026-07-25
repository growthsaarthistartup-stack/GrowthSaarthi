/**
 * Topic Suggestion Agent — suggests blog post topics and keywords based on website scan metadata.
 */

import { z } from "zod";
import { runAgent, type AgentContract } from "@/lib/agent-runner";
import { MODEL_ROUTES } from "@/lib/models";

const TopicSuggestionSchema = z.object({
  suggestions: z.array(z.object({
    title:       z.string().max(160),
    keywords:    z.array(z.string()).min(1).max(10),
    reason:      z.string().max(1000),
  })).min(1).max(3),
});

export type TopicSuggestions = z.infer<typeof TopicSuggestionSchema>;

const TOPIC_SUGGEST_AGENT: AgentContract<typeof TopicSuggestionSchema> = {
  name:          "topic_suggest_agent",
  model:         MODEL_ROUTES.blog_final_draft[0],
  fallbackModel: MODEL_ROUTES.blog_final_draft[1],
  systemPrompt:
    "You are an expert AI content strategist for growth marketing. " +
    "Analyze the provided website scan data (title, h1, meta description, and tech stack) for a startup. " +
    "Generate exactly 3 blog post titles and associated SEO keywords that would help them drive high-converting organic search traffic. " +
    "For each topic, provide a brief reason why it fits their positioning. " +
    "Output valid JSON only matching the schema structure. Do not include markdown fences.",
  outputSchema: TopicSuggestionSchema,
  maxRetries:   2,
};

export async function suggestBlogTopics(websiteInfo: {
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  techStack: string[];
}): Promise<TopicSuggestions> {
  const result = await runAgent(TOPIC_SUGGEST_AGENT, {
    websiteTitle: websiteInfo.title || "Unknown Title",
    websiteH1:    websiteInfo.h1 || "Unknown H1",
    metaDesc:     websiteInfo.metaDescription || "No meta description",
    techStack:    websiteInfo.techStack.join(", "),
  });
  return result;
}
