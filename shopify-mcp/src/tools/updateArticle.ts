import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for updateArticle
const UpdateArticleInputSchema = z.object({
  articleId: z.string().min(1).describe("The GID of the article to update (e.g., \"gid://shopify/Article/1234567890\")"),
  title: z.string().optional().describe("The new title for the article"),
  body: z.string().optional().describe("The new content for the article"),
  summary: z.string().optional().describe("A short summary of the article"),
  tags: z.array(z.string()).optional().describe("Tags for the article"),
  author: z.object({
    name: z.string()
  }).optional().describe("Author information for the article")
});

type UpdateArticleInput = z.infer<typeof UpdateArticleInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

/**
 * Tool for updating article details
 * @returns {Object} Updated article information
 */
const updateArticle = {
  name: "update-article",
  description: "Updates an article's details including title, content, summary, tags, and author",
  schema: UpdateArticleInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateArticleInput) => {
    try {
      const { articleId, ...updateData } = input;

      const mutation = gql`
        mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) {
            article {
              id
              title
              handle
              body
              summary
              tags
              author {
                name
              }
              image {
                id
                url
                altText
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: articleId,
        article: updateData
      };

      const data = await shopifyClient.request(mutation, variables) as {
        articleUpdate: {
          article: {
            id: string;
            title: string;
            handle: string;
            body: string;
            summary: string;
            tags: string[];
            author: {
              name: string;
            } | null;
            image: {
              id: string;
              url: string;
              altText: string | null;
            } | null;
          };
          userErrors: Array<{
            field: string;
            message: string;
          }>;
        };
      };

      if (data.articleUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update article: ${data.articleUpdate.userErrors
            .map((error) => error.message)
            .join(", ")}`
        );
      }

      return {
        article: data.articleUpdate.article
      };
    } catch (error) {
      console.error("Error updating article:", error);
      throw new Error(
        `Failed to update article: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateArticle }; 