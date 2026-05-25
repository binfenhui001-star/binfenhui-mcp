import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for updatePage
const UpdatePageInputSchema = z.object({
  pageId: z.string().min(1).describe("The GID of the page to update (e.g., \"gid://shopify/Page/1234567890\")"),
  title: z.string().optional().describe("The new title for the page"),
  body: z.string().optional().describe("The new body content for the page"),
  bodyHtml: z.string().optional().describe("The new HTML body content for the page"),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional()
  }).optional().describe("SEO information for the page"),
  published: z.boolean().optional().describe("Whether the page should be published or unpublished")
});

type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

/**
 * Tool for updating page details
 * @returns {Object} Updated page information
 */
const updatePage = {
  name: "update-page",
  description: "Updates a page's details including title, content, SEO information, and publish status",
  schema: UpdatePageInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdatePageInput) => {
    try {
      const { pageId, ...updateData } = input;

      const mutation = gql`
        mutation pageUpdate($input: PageInput!) {
          pageUpdate(input: $input) {
            page {
              id
              title
              handle
              bodySummary
              body
              bodyHtml
              updatedAt
              publishedAt
              seo {
                title
                description
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
        input: {
          id: pageId,
          ...updateData
        }
      };

      const data = await shopifyClient.request(mutation, variables) as {
        pageUpdate: {
          page: {
            id: string;
            title: string;
            handle: string;
            bodySummary: string;
            body: string;
            bodyHtml: string;
            updatedAt: string;
            publishedAt: string;
            seo: {
              title: string;
              description: string;
            };
          };
          userErrors: Array<{
            field: string;
            message: string;
          }>;
        };
      };

      if (data.pageUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update page: ${data.pageUpdate.userErrors
            .map((error) => error.message)
            .join(", ")}`
        );
      }

      return {
        page: data.pageUpdate.page
      };
    } catch (error) {
      console.error("Error updating page:", error);
      throw new Error(
        `Failed to update page: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updatePage }; 