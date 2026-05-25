Thank you for providing this incredibly detailed and comprehensive project plan! This document offers a clear strategic vision for the AI Coding Agent's capabilities and the phased implementation. I understand that this plan is the source material for the detailed markdown checklist you requested, and I will now proceed to generate that checklist based on this document.

Given that the "AI is already in the existing project," the checklist will reflect this by framing tasks for new components as "Create/Implement" and tasks for existing, relevant components as "Review/Enhance/Ensure/Refactor" to align with the current codebase.

This will be an extensive checklist. I will generate it incrementally, focusing on breaking down each phase and task from your plan into granular, one-story-point actions suitable for an AI Coding Agent.

Here is the beginning of the detailed markdown checklist, starting with **Phase 1: Foundation & Core Product Management** from your document:

---

**Project Plan Checklist: AI-Powered Shopify Content Automation via MCP**

**Phase 1: Foundation & Core Product Management (Months 1-3)**

*   **Objective:** Establish the core infrastructure and basic product interaction capabilities.

**High-Level Requirement 1.1 (from Document Phase 1 Tasks): Develop the Shopify MCP Server with initial tools for product data retrieval (titles, descriptions) and simple updates (e.g., title, description, basic image alt text).**

    **Story 1.1.1: Ensure Robust Retrieval of Product Titles and Descriptions**
    *   **Goal:** The AI Agent can reliably fetch product titles and descriptions using existing/enhanced MCP tools.
    *   **Tasks:**
        *   `[x]` Review `src/tools/getProductById.ts`: Verify that the `product(id: $id)` GraphQL query fetches `title`.
        *   `[x]` Review `src/tools/getProductById.ts`: Verify that the `product(id: $id)` GraphQL query fetches `descriptionHtml` (for full description).
        *   `[x]` Review `src/tools/getProductById.ts`: Ensure the `execute` function correctly extracts and returns `title` in the formatted product data.
        *   `[x]` Review `src/tools/getProductById.ts`: Ensure the `execute` function correctly extracts and returns `descriptionHtml` (or an equivalent like `description`) in the formatted product data.
        *   `[x]` Review `src/tools/getProducts.ts`: Verify that the `products(first: $first, query: $query)` GraphQL query fetches `title` for each product.
        *   `[x]` Review `src/tools/getProducts.ts`: Verify that the `products(first: $first, query: $query)` GraphQL query fetches `descriptionHtml` or a summary description for each product.
        *   `[x]` Review `src/tools/getProducts.ts`: Ensure the `execute` function correctly extracts and returns `title` for each product in the list.
        *   `[x]` Review `src/tools/getProducts.ts`: Ensure the `execute` function correctly extracts and returns `descriptionHtml` (or `description`) for each product in the list.
        *   `[x]` Review input schema `GetProductByIdInputSchema` in `getProductById.ts`: Ensure `productId` description clearly states it expects a GID (e.g., "gid://shopify/Product/1234567890").
        *   `[x]` Add comprehensive JSDoc comments to the fields returned by `getProductById.execute` related to title and description, explaining their significance for SEO.
        *   `[x]` Add comprehensive JSDoc comments to the fields returned by `getProducts.execute` related to titles and descriptions.
        *   `[x]` Update `README.md`: Section "Product Management" for `get-product-by-id`, ensure input `productId` GID format is clear.
        *   `[x]` Update `README.md`: Section "Product Management" for `get-product-by-id`, list `title` and `descriptionHtml` (or `description`) as key output fields.
        *   `[x]` Update `README.md`: Section "Product Management" for `get-products`, list `title` and `descriptionHtml` (or `description`) as key output fields for each product.

    **Story 1.1.2: Ensure Robust Update Capabilities for Product Titles and Descriptions**
    *   **Goal:** The AI Agent can reliably update product titles and descriptions using existing/enhanced MCP tools.
    *   **Tasks:**
        *   `[x]` Review `src/tools/updateProduct.ts`: Verify the `UpdateProductInputSchema` includes `title` as an optional string.
        *   `[x]` Review `src/tools/updateProduct.ts`: Verify the `UpdateProductInputSchema` includes `descriptionHtml` as an optional string. If not, add it: `descriptionHtml: z.string().optional().describe("The new HTML description for the product.")`.
        *   `[x]` Review the `productUpdate` GraphQL mutation in `updateProduct.ts`: Ensure it includes `title` in the `$input: ProductInput!` and in the returned `product` fields.
        *   `[x]` Review the `productUpdate` GraphQL mutation in `updateProduct.ts`: Ensure it includes `descriptionHtml` in the `$input: ProductInput!` and in the returned `product` fields. If `descriptionHtml` was added to schema, update mutation variables accordingly.
        *   `[x]` Review `updateProduct.ts` `execute` method: Ensure `title` from input is correctly passed to the Shopify `productUpdate` mutation variables if provided.
        *   `[x]` Review `updateProduct.ts` `execute` method: Ensure `descriptionHtml` from input is correctly passed to the Shopify `productUpdate` mutation variables if provided.
        *   `[x]` Ensure the Zod schema for `update-product` in `src/index.ts` matches the `UpdateProductInputSchema` in `updateProduct.ts`, especially for `title` and `descriptionHtml`.
        *   `[x]` Update `README.md`: Section "Product Management" for `update-product`, ensure `title` and `descriptionHtml` are listed as optional input parameters with clear descriptions.

    **Story 1.1.3: Implement Tool for Updating Product Image Alt Text**
    *   **Goal:** The AI Agent can update the alt text of a specific product image.
    *   **Tasks:**
        *   `[ ]` Determine if `updateProductImageAltText` will be a new tool or integrated into `updateProduct.ts`. (Decision: New tool for clarity, matching `productUpdateMedia`'s focus).
        *   `[ ]` Create a new file: `src/tools/updateProductImageAltText.ts`.
        *   `[ ]` In `updateProductImageAltText.ts`, define `UpdateProductImageAltTextInputSchema` using Zod:
            *   `[ ]` Add `imageId: z.string().min(1).describe("The GID of the product image/media to update (e.g., \"gid://shopify/ProductImage/123\" or \"gid://shopify/MediaImage/123\").")`.
            *   `[ ]` Add `altText: z.string().max(512, "Alt text should be 512 characters or less.").nullable().describe("The new descriptive alt text for the image. Set to null to remove.")`. (Shopify's limit is 512, but best practice is ~125)
        *   `[ ]` In `updateProductImageAltText.ts`, define the `updateProductImageAltText` tool object (`name`, `description`, `schema`, `initialize`, `execute`).
        *   `[ ]` `updateProductImageAltText.description`: "Updates the alt text for a specific product image."
        *   `[ ]` In `updateProductImageAltText.execute`, implement the GraphQL mutation `productUpdateMedia`.
            *   `[ ]` Mutation signature: `mutation productUpdateMedia($mediaId: ID!, $altText: String) { productUpdateMedia(mediaId: $mediaId, altText: $altText) { media { ... on MediaImage { id alt } } userErrors { field message } } }`.
            *   `[ ]` Ensure variables are correctly passed: `{ mediaId: imageId, altText: altText }`. Note: `productUpdateMedia` might take a list `[MediaUserError!]!` for `userErrors` and `[Media!]!` for `media`. Check API docs for exact return types. Or use `fileUpdate` with `MediaImageInput`. (Clarification: `productUpdateMedia` seems more direct for an existing product image, rather than general `fileUpdate`. The schema `ProductUpdateMediaInput` expects `alt` not `altText` for the field name, and `mediaId` is the ID of the `MediaImage`).
            *   Let's refine the mutation based on typical Shopify `productUpdateMedia` or alternative `mediaUpdate` if available for images. For `productUpdateMedia` it might be part of a larger product update or a specific `productImageUpdate` mutation if one exists. A common pattern is updating `ImageInput` on a `ProductInput`. If specific `productImageUpdate` is not direct, it might be `productUpdate` with `images: [{id: imageId, altText: newAltText}]` or `media: [{id: imageId, alt: newAltText}]`.
            *   **Correction/Clarification based on Shopify docs:** The `productUpdate` mutation can accept a `media` argument array of `CreateMediaInput` which includes `alt`. For updating *existing* media, `productUpdateMedia` is better if it directly supports `alt`. If not, a `productUpdate` with `images: [{ id: imageId, altText: altText }]` can work. However, the direct approach for updating an *existing* `MediaImage` `alt` text is often via `mediaUpdate(input: {id: ID!, image: {altText: String}})` or a similar specific mutation. Let's assume for now `productUpdateMedia` exists and takes `alt` and `mediaId`. If not, a `productUpdate` with nested image `altText` might be needed. A safer bet for an *existing* MediaImage is often `fileUpdate` if `MediaImage` is a `File`.
            *   **Revised Approach for Alt Text Update:** Using `productUpdate` mutation with `media` array containing objects with `id` and `alt`.
            *   `[ ]` Define mutation: `mutation productUpdateAltText($input: ProductInput!) { productUpdate(input: $input) { product { id media(first: 5) { edges { node { ... on MediaImage { id alt } } } } } userErrors { field message } } }`.
            *   `[ ]` Construct input for productUpdate: `{ id: productId, media: [{ id: imageId, alt: newAltText }] }`. This requires `productId` as well. Schema needs `productId`.
            *   **Revised Schema for `updateProductImageAltText`:**
                *   `[ ]` Add `productId: z.string().min(1).describe("The GID of the product to which the image belongs.")`.
                *   `[ ]` `imageId` will be the GID of the `MediaImage`.
                *   `[ ]` `altText` is the new alt text.
            *   `[ ]` Update `execute` logic to use `productUpdate` with the `media` input structure for updating alt text: `variables = { input: { id: productId, media: [ { id: imageId, alt: altText } ] } }`.
        *   `[ ]` In `updateProductImageAltText.execute`, handle `userErrors` from the mutation response.
        *   `[ ]` In `updateProductImageAltText.execute`, return the updated media information or a success message.
        *   `[ ]` In `src/index.ts`, import `updateProductImageAltText`.
        *   `[ ]` In `src/index.ts`, initialize `updateProductImageAltText` with `shopifyClient`.
        *   `[ ]` In `src/index.ts`, register the `update-product-image-alt-text` tool with its schema.
        *   `[ ]` In `README.md`, add a new tool under "Product Management": `update-product-image-alt-text`.
            *   `[ ]` Document its purpose: "Updates the alt text for a specific product image."
            *   `[ ]` Document inputs: `productId` (string, required, GID of product), `imageId` (string, required, GID of media image), `altText` (string, nullable, new alt text, max 512 chars).

*(Self-correction: The initial thought for `updateProductImageAltText` needed refinement on how Shopify handles image alt text updates. The `productUpdate` mutation with a `media` array specifying the `id` of the media and the new `alt` field is a robust way for existing media. This means the tool needs both `productId` and `imageId` (Media GID).*

**High-Level Requirement 1.2 (from Document Phase 1 Tasks): Implement secure authentication for the MCP server and its connection to Shopify.**

    **Story 1.2.1: Secure Shopify API Credentials in MCP Server**
    *   **Goal:** Shopify Admin API access token and domain are securely managed by the MCP server and not exposed.
    *   **Tasks:**
        *   `[ ]` Review `src/index.ts`: Confirm `SHOPIFY_ACCESS_TOKEN` is sourced from `argv.accessToken` or `process.env.SHOPIFY_ACCESS_TOKEN`.
        *   `[ ]` Review `src/index.ts`: Confirm `MYSHOPIFY_DOMAIN` is sourced from `argv.domain` or `process.env.MYSHOPIFY_DOMAIN`.
        *   `[ ]` Review `src/index.ts`: Ensure no hardcoding of these credentials.
        *   `[ ]` Review `src/index.ts`: Ensure these credentials are used *only* for server-side GraphQL client initialization.
        *   `[ ]` Update `README.md` section "Setup": Emphasize the security of the `SHOPIFY_ACCESS_TOKEN`.
        *   `[ ]` Update `.gitignore`: Ensure `.env` is listed to prevent accidental commits of credentials. (Already present, verify).
        *   `[ ]` Create/Update `README.md` or a separate security document: Add a note on best practices for managing the `.env` file or command-line arguments in production (e.g., using platform-specific secret management).

    **Story 1.2.2: Plan for MCP Client to MCP Server Authentication (Public Exposure)**
    *   **Goal:** Outline the strategy for securing the publicly accessible MCP server endpoint. (This story is primarily planning & documentation for future implementation as per Doc 3.1.3, actual implementation might be a later phase).
    *   **Tasks:**
        *   `[ ]` Research and document OAuth 2.0 Bearer Token authentication mechanisms suitable for an Node.js/Express based MCP server (even if current transport is Stdio, prepare for HTTP/SSE).
        *   `[ ]` Document how an `authorization_token` would be received and validated by the MCP server if it were using HTTP/SSE.
        *   `[ ]` Document how the `StdioServerTransport` would need to be replaced or augmented to support HTTP/SSE for public exposure. (Currently `StdioServerTransport` is used).
        *   `[ ]` Create a placeholder section in `README.md` or a new `SECURITY.md` file titled "MCP Server Authentication (Future)" outlining the intent to use token-based auth for public endpoints.
        *   `[ ]` Note in project documentation: The current `StdioServerTransport` is not suitable for public exposure as per MCP connector requirements for remote servers. Phase 1 might focus on local/Claude Desktop usage with CLI args for token/domain.

**High-Level Requirement 1.3 (from Document Phase 1 Tasks): Integrate the MCP server with Claude Desktop for interactive testing and initial use-cases.**

    **Story 1.3.1: Ensure Compatibility and Configuration for Claude Desktop**
    *   **Goal:** The Shopify MCP server can be easily configured and used within Claude Desktop.
    *   **Tasks:**
        *   `[ ]` Review `README.md` section "Usage with Claude Desktop": Verify the `claude_desktop_config.json` example is accurate for the current server structure (`shopify-mcp` command, `--accessToken`, `--domain` args).
        *   `[ ]` Test the `npx shopify-mcp --accessToken ... --domain ...` command locally to ensure it starts correctly without a `.env` file.
        *   `[ ]` Manually create a `claude_desktop_config.json` as per README instructions and attempt to connect Claude Desktop to a locally running instance of `shopify-mcp`.
        *   `[ ]` Test a simple read-only tool (e.g., `get-products`) via Claude Desktop to confirm basic communication.
        *   `[ ]` Document any observed issues or necessary clarifications for Claude Desktop setup in `README.md`.
        *   `[ ]` Add a note to `README.md` about Claude Desktop's permission model for tool execution (user prompts for actions).
        *   `[ ]` Verify that tool descriptions in `src/index.ts` (and individual tool files) are clear and human-readable, as Claude uses these. (Ongoing task for all tools).

**High-Level Requirement 1.4 (from Document Phase 1 Tasks): Set up foundational Google Analytics 4 and Google Search Console tracking for the Shopify store.**

    **Story 1.4.1: Document Standard GA4 and GSC Setup for Shopify**
    *   **Goal:** Provide clear instructions in the project documentation on how a user should set up GA4 and GSC for their Shopify store, as this is external to the MCP server but relevant for later phases.
    *   **Tasks:**
        *   `[ ]` Create a new section in `README.md` titled "Analytics Setup for Performance Monitoring" or a separate `ANALYTICS_SETUP.md` file.
        *   `[ ]` Add step-by-step instructions or links to official Shopify/Google guides for integrating Google Analytics 4 with a Shopify store.
            *   `[ ]` Include options: native integration, Google & YouTube app, Google Tag Manager.
        *   `[ ]` Add step-by-step instructions or links to official Google guides for verifying a Shopify store with Google Search Console.
        *   `[ ]` Briefly explain the purpose of GA4 (traffic, user behavior, conversions) and GSC (organic search performance, indexing) in this context.
        *   `[ ]` Add a note that MCP tools for interacting with GA4/GSC APIs will be developed in a later phase (as per Doc Phase 4).

---

This covers the breakdown of the first few high-level requirements from Phase 1 of your project plan. I will continue generating the checklist for subsequent phases and requirements in this manner if you'd like me to proceed. Please let me know how you'd like to continue!