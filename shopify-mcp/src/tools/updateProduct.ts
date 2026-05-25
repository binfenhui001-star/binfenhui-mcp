import { GraphQLClient, gql } from "graphql-request";
import { z } from "zod";

// Input schema for updateProduct
const UpdateProductInputSchema = z.object({
  productId: z.string().min(1).describe("The GID of the product to update (e.g., \"gid://shopify/Product/1234567890\")"),
  title: z.string().optional().describe("The new title for the product"),
  descriptionHtml: z.string().optional().describe("The new HTML description for the product"),
  seo: z.object({
    title: z.string().optional().describe("SEO-optimized title for the product"),
    description: z.string().optional().describe("SEO meta description for the product")
  }).optional().describe("SEO information for the product"),
  status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]).optional().describe("Product status (ACTIVE, ARCHIVED, or DRAFT)"),
  vendor: z.string().optional().describe("The vendor or manufacturer of the product"),
  productType: z.string().optional().describe("The type or category of the product"),
  tags: z.array(z.string()).optional().describe("Array of tags to categorize the product"),
  variants: z.array(z.object({
    id: z.string().optional().describe("The GID of the variant to update"),
    price: z.string().optional().describe("The price of the variant"),
    compareAtPrice: z.string().optional().describe("Compare at price for showing a markdown"),
    sku: z.string().optional().describe("Stock keeping unit (SKU)"),
    barcode: z.string().optional().describe("Barcode (ISBN, UPC, GTIN, etc.)"),
    inventoryQuantity: z.number().optional().describe("Available inventory quantity"),
    inventoryPolicy: z.enum(["DENY", "CONTINUE"]).optional().describe("What happens when a variant is out of stock"),
    fulfillmentService: z.string().optional().describe("Service responsible for fulfilling the variant"),
    weight: z.number().optional().describe("Weight of the variant"),
    weightUnit: z.enum(["KILOGRAMS", "GRAMS", "POUNDS", "OUNCES"]).optional().describe("Unit of weight measurement")
  })).optional().describe("Product variants to update")
});

type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

interface ProductUpdateResponse {
  productUpdate: {
    product: {
      id: string;
      title: string;
      descriptionHtml: string;
      handle: string;
      status: string;
      vendor: string;
      productType: string;
      tags: string[];
      seo: {
        title: string;
        description: string;
      };
      variants: {
        edges: Array<{
          node: {
            id: string;
            title: string;
            price: string;
            compareAtPrice: string | null;
            sku: string;
            barcode: string | null;
            inventoryQuantity: number;
            inventoryPolicy: string;
          };
        }>;
      };
      updatedAt: string;
    };
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  };
}

interface VariantsBulkUpdateResponse {
  productVariantsBulkUpdate: {
    productVariants: Array<{
      id: string;
      title: string;
      price: string;
      compareAtPrice: string | null;
      sku: string;
      barcode: string | null;
      inventoryQuantity: number;
      inventoryPolicy: string;
    }>;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  };
}

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const updateProductMutation = gql`
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        descriptionHtml
        handle
        status
        vendor
        productType
        tags
        seo {
          title
          description
        }
        variants(first: 50) {
          edges {
            node {
              id
              title
              price
              compareAtPrice
              sku
              barcode
              inventoryQuantity
              inventoryPolicy
            }
          }
        }
        updatedAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const updateVariantsMutation = gql`
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
        sku
        barcode
        inventoryQuantity
        inventoryPolicy
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Tool for updating product details including SEO-relevant fields
 * @returns {Object} Updated product details
 */
const updateProduct = {
  name: "update-product",
  description: "Update a product's details including title, description, SEO, status, variants, and more",
  schema: UpdateProductInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize: (client: GraphQLClient) => {
    updateProduct.client = client;
  },

  execute: async (input: UpdateProductInput) => {
    if (!updateProduct.client) {
      throw new Error('GraphQL client not initialized. Call initialize() first.');
    }

    try {
      const { productId, variants, ...productInput } = input;
      let response: ProductUpdateResponse;

      // If we're only updating variants, fetch the initial product data
      if (Object.keys(productInput).length === 0) {
        response = await updateProduct.client.request<ProductUpdateResponse>(updateProductMutation, {
          input: { id: productId }
        });
      } else {
        // Update product details
        response = await updateProduct.client.request<ProductUpdateResponse>(updateProductMutation, {
          input: {
            id: productId,
            ...productInput
          }
        });

        if (response.productUpdate.userErrors.length > 0) {
          throw new Error(
            `Failed to update product: ${response.productUpdate.userErrors
              .map((error) => error.message)
              .join(", ")}`
          );
        }
      }

      // Update variants if provided
      if (variants && variants.length > 0) {
        const variantResponse = await updateProduct.client.request<VariantsBulkUpdateResponse>(updateVariantsMutation, {
          productId,
          variants: variants.map(variant => ({
            id: variant.id,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            sku: variant.sku,
            barcode: variant.barcode,
            inventoryPolicy: variant.inventoryPolicy
          }))
        });

        if (variantResponse.productVariantsBulkUpdate.userErrors.length > 0) {
          throw new Error(
            `Failed to update variants: ${variantResponse.productVariantsBulkUpdate.userErrors
              .map((error) => error.message)
              .join(", ")}`
          );
        }

        // Fetch the latest product data after variant update
        response = await updateProduct.client.request<ProductUpdateResponse>(updateProductMutation, {
          input: { id: productId }
        });
      }

      // Format variants for response
      const formattedVariants = response.productUpdate.product.variants.edges.map((edge) => ({
        id: edge.node.id,
        title: edge.node.title,
        price: edge.node.price,
        compareAtPrice: edge.node.compareAtPrice,
        sku: edge.node.sku,
        barcode: edge.node.barcode,
        inventoryQuantity: edge.node.inventoryQuantity,
        inventoryPolicy: edge.node.inventoryPolicy
      }));

      return {
        product: {
          id: response.productUpdate.product.id,
          title: response.productUpdate.product.title,
          descriptionHtml: response.productUpdate.product.descriptionHtml,
          handle: response.productUpdate.product.handle,
          status: response.productUpdate.product.status,
          vendor: response.productUpdate.product.vendor,
          productType: response.productUpdate.product.productType,
          tags: response.productUpdate.product.tags,
          seo: response.productUpdate.product.seo,
          variants: formattedVariants,
          updatedAt: response.productUpdate.product.updatedAt
        }
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to update product: ${error.message}`);
      }
      throw new Error('Failed to update product: Unknown error');
    }
  },

  client: null as GraphQLClient | null
};

export { updateProduct }; 