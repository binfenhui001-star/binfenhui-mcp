import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getProductById
const GetProductByIdInputSchema = z.object({
  productId: z.string().min(1).describe("The GID of the product to fetch (e.g., \"gid://shopify/Product/1234567890\")")
});

type GetProductByIdInput = z.infer<typeof GetProductByIdInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

/**
 * Tool for fetching a specific product by ID with all its details
 * @returns {Object} Product details including SEO-relevant fields
 */
const getProductById = {
  name: "get-product-by-id",
  description: "Get a specific product by ID including title, description, and SEO-relevant fields",
  schema: GetProductByIdInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductByIdInput) => {
    try {
      const { productId } = input;

      const query = gql`
        query GetProductById($id: ID!) {
          product(id: $id) {
            id
            title
            description
            descriptionHtml
            handle
            status
            createdAt
            updatedAt
            totalInventory
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            images(first: 5) {
              edges {
                node {
                  id
                  url
                  altText
                  width
                  height
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryQuantity
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            collections(first: 5) {
              edges {
                node {
                  id
                  title
                }
              }
            }
            tags
            vendor
          }
        }
      `;

      const variables = {
        id: productId
      };

      const data = (await shopifyClient.request(query, variables)) as {
        product: any;
      };

      if (!data.product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      // Format product data
      const product = data.product;

      // Format variants
      const variants = product.variants.edges.map((variantEdge: any) => ({
        id: variantEdge.node.id,
        title: variantEdge.node.title,
        price: variantEdge.node.price,
        inventoryQuantity: variantEdge.node.inventoryQuantity,
        sku: variantEdge.node.sku,
        options: variantEdge.node.selectedOptions
      }));

      // Format images
      const images = product.images.edges.map((imageEdge: any) => ({
        id: imageEdge.node.id,
        url: imageEdge.node.url,
        altText: imageEdge.node.altText,
        width: imageEdge.node.width,
        height: imageEdge.node.height
      }));

      // Format collections
      const collections = product.collections.edges.map(
        (collectionEdge: any) => ({
          id: collectionEdge.node.id,
          title: collectionEdge.node.title
        })
      );

      /**
       * @typedef {Object} FormattedProduct
       * @property {string} id - The unique GID of the product
       * @property {string} title - The product title, optimized for SEO
       * @property {string} description - The plain text description of the product
       * @property {string} descriptionHtml - The HTML formatted description of the product
       * @property {string} handle - The URL-friendly handle/slug of the product
       * @property {string} status - Current status of the product (e.g., ACTIVE, ARCHIVED)
       * @property {string} createdAt - Product creation timestamp
       * @property {string} updatedAt - Last update timestamp
       * @property {number} totalInventory - Total available inventory across all variants
       */
      const formattedProduct = {
        id: product.id,
        title: product.title,
        description: product.description,
        descriptionHtml: product.descriptionHtml,
        handle: product.handle,
        status: product.status,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        totalInventory: product.totalInventory,
        priceRange: {
          minPrice: {
            amount: product.priceRangeV2.minVariantPrice.amount,
            currencyCode: product.priceRangeV2.minVariantPrice.currencyCode
          },
          maxPrice: {
            amount: product.priceRangeV2.maxVariantPrice.amount,
            currencyCode: product.priceRangeV2.maxVariantPrice.currencyCode
          }
        },
        images,
        variants,
        collections,
        tags: product.tags,
        vendor: product.vendor
      };

      return { product: formattedProduct };
    } catch (error) {
      console.error("Error fetching product by ID:", error);
      throw new Error(
        `Failed to fetch product: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getProductById };
