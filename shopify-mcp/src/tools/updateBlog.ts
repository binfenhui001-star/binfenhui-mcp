import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for updateBlog
const UpdateBlogInputSchema = z.object({
  blogId: z.string().min(1).describe("The GID of the blog to update (e.g., \"gid://shopify/Blog/1234567890\")"),
  title: z.string().optional().describe("The new title for the blog"),
  handle: z.string().optional().describe("The URL-friendly handle for the blog"),
  templateSuffix: z.string().optional().describe("The template suffix for the blog"),
  commentPolicy: z.enum(["MODERATED", "CLOSED"]).optional().describe("The comment policy for the blog")
});

type UpdateBlogInput = z.infer<typeof UpdateBlogInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

/**
 * Tool for updating blog details
 * @returns {Object} Updated blog information
 */
const updateBlog = {
  name: "update-blog",
  description: "Updates a blog's details including title, handle, template suffix, and comment policy",
  schema: UpdateBlogInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateBlogInput) => {
    try {
      const { blogId, ...updateData } = input;

      const mutation = gql`
        mutation UpdateBlog($id: ID!, $blog: BlogUpdateInput!) {
          blogUpdate(id: $id, blog: $blog) {
            blog {
              id
              title
              handle
              templateSuffix
              commentPolicy
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: blogId,
        blog: updateData
      };

      const data = await shopifyClient.request(mutation, variables) as {
        blogUpdate: {
          blog: {
            id: string;
            title: string;
            handle: string;
            templateSuffix: string | null;
            commentPolicy: string;
          };
          userErrors: Array<{
            field: string;
            message: string;
          }>;
        };
      };

      if (data.blogUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update blog: ${data.blogUpdate.userErrors
            .map((error) => error.message)
            .join(", ")}`
        );
      }

      return {
        blog: data.blogUpdate.blog
      };
    } catch (error) {
      console.error("Error updating blog:", error);
      throw new Error(
        `Failed to update blog: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateBlog }; 