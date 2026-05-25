import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const CreateBlogInputSchema = z.object({
  title: z.string().min(1).describe("The title of the blog"),
  handle: z.string().optional().describe("The URL-friendly handle for the blog. If not provided, it will be generated from the title."),
  templateSuffix: z.string().optional().describe("The template suffix for the blog"),
  commentPolicy: z.enum(["MODERATED", "CLOSED"]).optional().describe("The comment policy for the blog")
});

type CreateBlogInput = z.infer<typeof CreateBlogInputSchema>;

let shopifyClient: GraphQLClient;

const createBlog = {
  name: "create-blog",
  description: "Creates a new blog with the specified details",
  schema: CreateBlogInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  async execute(input: CreateBlogInput) {
    try {
      const mutation = gql`
        mutation CreateBlog($blog: BlogCreateInput!) {
          blogCreate(blog: $blog) {
            blog {
              id
              title
              handle
              templateSuffix
              commentPolicy
              createdAt
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = await shopifyClient.request(mutation, { blog: input }) as {
        blogCreate: {
          blog: {
            id: string;
            title: string;
            handle: string;
            templateSuffix: string | null;
            commentPolicy: string;
            createdAt: string;
          };
          userErrors: Array<{
            field: string;
            message: string;
          }>;
        };
      };

      if (data.blogCreate.userErrors.length > 0) {
        throw new Error(
          `Failed to create blog: ${data.blogCreate.userErrors
            .map((error) => error.message)
            .join(", ")}`
        );
      }

      return {
        blog: data.blogCreate.blog
      };
    } catch (error) {
      console.error("Error creating blog:", error);
      throw new Error(
        `Failed to create blog: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
};

export { createBlog }; 