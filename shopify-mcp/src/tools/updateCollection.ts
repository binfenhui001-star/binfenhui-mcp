import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for updateCollection
const UpdateCollectionInputSchema = z.object({
  collectionId: z.string().min(1).describe("The GID of the collection to update (e.g., \"gid://shopify/Collection/1234567890\")"),
  title: z.string().optional().describe("The new title for the collection"),
  description: z.string().optional().describe("The new description for the collection"),
  descriptionHtml: z.string().optional().describe("The new HTML description for the collection"),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional()
  }).optional().describe("SEO information for the collection")
});

type UpdateCollectionInput = z.infer<typeof UpdateCollectionInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

/**
 * Tool for updating collection details
 * @returns {Object} Updated collection information
 */
const updateCollection = {
  name: "update-collection",
  description: "Updates a collection's details including title, description, and SEO information",
  schema: UpdateCollectionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateCollectionInput) => {
    try {
      const { collectionId, ...updateData } = input;

      const mutation = gql`
        mutation collectionUpdate($input: CollectionInput!) {
          collectionUpdate(input: $input) {
            collection {
              id
              title
              handle
              description
              descriptionHtml
              updatedAt
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
          id: collectionId,
          ...updateData
        }
      };

      const data = await shopifyClient.request(mutation, variables) as {
        collectionUpdate: {
          collection: {
            id: string;
            title: string;
            handle: string;
            description: string;
            descriptionHtml: string;
            updatedAt: string;
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

      if (data.collectionUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update collection: ${data.collectionUpdate.userErrors
            .map((error) => error.message)
            .join(", ")}`
        );
      }

      return {
        collection: data.collectionUpdate.collection
      };
    } catch (error) {
      console.error("Error updating collection:", error);
      throw new Error(
        `Failed to update collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateCollection }; 