// ==============================================================================
// WISHRITE INVENTORY — GEMINI PRODUCT CONTENT & SEO AUTO-GENERATION SERVICE
// Analyzes uploaded primary product images and generates structured e-commerce
// copy, short descriptions, full descriptions, and SEO metadata.
// ==============================================================================

import { GoogleGenAI, Type } from '@google/genai';

const SYSTEM_INSTRUCTION = `You are an expert luxury jewellery e-commerce product copywriter and SEO specialist for WishRite.

Analyze the uploaded product image carefully.

Identify only characteristics that are visually supported by the image.

Never invent:
- metal purity
- gemstone type
- gemstone quality
- weight
- dimensions
- certification
- anti-tarnish claims
- plating
- manufacturing details

If a property cannot be confidently determined from the image, do not claim it as fact.

WishRite products are 925 sterling silver.
Where product data confirms purity = 925 / 92.5%, the generated copy may naturally mention 925 sterling silver.

However, do not invent a product attribute that is not supported by the product data or business rules.

Create premium, natural, Indian e-commerce-friendly copy.
Avoid keyword stuffing.
Do not mention AI.
Do not mention that the content was generated automatically.
Do not use fake claims such as:
- best
- guaranteed
- certified
- hypoallergenic
- lifetime
- 100% tarnish proof
unless explicitly provided by product data.

Keep the content elegant, premium and conversion-oriented.

Field Guidelines:
1. Product Name:
   - Concise and identifies the jewellery piece.
   - Includes 925 Sterling Silver when appropriate.
   - Natural, premium, avoid excessive marketing buzzwords.
   - Example: "925 Sterling Silver Heart Charm Bracelet"

2. Short Description:
   - Approximately 1–2 concise sentences.
   - Focus on product type, visual design, elegance, and intended audience (where visually or contextually supported).

3. Product Description:
   - Structured luxury e-commerce copy:
     * Opening product statement
     * Key visual / craftsmanship / design characteristics
     * Styling / use occasion
     * Closing premium shopping statement
   - Do NOT invent technical specifications not visible in the image or context.

4. SEO Meta Title:
   - Target length: approximately 50–60 characters where practical.
   - Format example: "925 Sterling Silver Heart Charm Bracelet | WishRite"
   - Brand: WishRite

5. SEO Meta Description:
   - Target length: approximately 140–160 characters where practical.
   - Describe the actual product naturally with primary search phrase.
   - Mention 925 sterling silver where appropriate.
   - Attractive to shoppers, avoid keyword stuffing and unsupported claims.

6. SEO Keywords:
   - Comma-separated search phrases relevant to the jewellery item.
   - Example: "925 sterling silver bracelet, silver heart bracelet, heart charm bracelet, women's silver bracelet, sterling silver jewellery"
   - Do not repeat the same keyword excessively.`;

const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        product_name: {
            type: Type.STRING,
            description: 'Concise, elegant product name identifying the jewellery piece'
        },
        short_description: {
            type: Type.STRING,
            description: '1-2 concise sentences highlighting visual design and elegance'
        },
        product_description: {
            type: Type.STRING,
            description: 'Structured premium e-commerce copy for the product page'
        },
        seo_title: {
            type: Type.STRING,
            description: 'SEO meta title approximately 50-60 characters ending with | WishRite'
        },
        seo_description: {
            type: Type.STRING,
            description: 'SEO meta description approximately 140-160 characters'
        },
        seo_keywords: {
            type: Type.STRING,
            description: 'Comma-separated relevant search keywords and phrases'
        }
    },
    required: [
        'product_name',
        'short_description',
        'product_description',
        'seo_title',
        'seo_description',
        'seo_keywords'
    ]
};

/**
 * Sanitizes and normalizes the parsed Gemini output
 */
function sanitizeGeneratedContent(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('AI content generation returned an invalid non-object response');
    }

    const productName = String(raw.product_name || '').trim();
    const shortDesc = String(raw.short_description || '').trim();
    const productDesc = String(raw.product_description || '').trim();
    let seoTitle = String(raw.seo_title || '').trim();
    const seoDesc = String(raw.seo_description || '').trim();
    let seoKeywords = String(raw.seo_keywords || '').trim();

    if (!productName) throw new Error('AI generation failed to produce a valid product name');
    if (!shortDesc) throw new Error('AI generation failed to produce a valid short description');
    if (!productDesc) throw new Error('AI generation failed to produce a valid product description');

    // Ensure SEO Title has brand if reasonable
    if (seoTitle && !seoTitle.toLowerCase().includes('wishrite')) {
        seoTitle = `${seoTitle} | WishRite`;
    }

    // Clean up keywords: ensure comma-separated and trimmed
    if (seoKeywords) {
        seoKeywords = seoKeywords
            .split(',')
            .map(k => k.trim())
            .filter(Boolean)
            .join(', ');
    }

    return {
        product_name: productName,
        short_description: shortDesc,
        product_description: productDesc,
        seo_title: seoTitle,
        seo_description: seoDesc,
        seo_keywords: seoKeywords
    };
}

/**
 * Generate Product SEO and Content using Gemini multimodal model
 * @param {Object} options
 * @param {Buffer} [options.imageBuffer] - Raw buffer of uploaded product image
 * @param {string} [options.imageUrl] - Public / accessible image URL
 * @param {string} [options.imageBase64] - Base64 data string (with or without data URI prefix)
 * @param {string} [options.mimeType] - e.g. 'image/jpeg', 'image/png', 'image/webp'
 * @param {Object} [options.productContext] - Existing product metadata (category, audience, material, etc.)
 * @returns {Promise<{success: boolean, data: Object, model: string}>}
 */
export async function generateProductContent({
    imageBuffer,
    imageUrl,
    imageBase64,
    mimeType = 'image/jpeg',
    productContext = {}
}) {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
        const err = new Error('GEMINI_API_KEY is not configured in the server environment.');
        err.code = 'GEMINI_KEY_MISSING';
        err.status = 500;
        throw err;
    }

    // Resolve image base64 data and mimeType
    let resolvedBase64 = null;
    let resolvedMime = mimeType || 'image/jpeg';

    if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
        resolvedBase64 = imageBuffer.toString('base64');
    } else if (imageBase64 && typeof imageBase64 === 'string') {
        const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
            resolvedMime = matches[1];
            resolvedBase64 = matches[2];
        } else {
            resolvedBase64 = imageBase64.trim();
        }
    } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
        const fetchTimeout = 20000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

        try {
            const resp = await fetch(imageUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                throw new Error(`Failed to fetch source image (HTTP ${resp.status})`);
            }

            const headerMime = resp.headers.get('content-type');
            if (headerMime) resolvedMime = headerMime.split(';')[0].trim();

            const arrayBuf = await resp.arrayBuffer();
            resolvedBase64 = Buffer.from(arrayBuf).toString('base64');
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            const err = new Error(`Unable to fetch product image for AI analysis: ${fetchErr.message}`);
            err.code = 'IMAGE_FETCH_FAILED';
            err.status = 400;
            throw err;
        }
    }

    if (!resolvedBase64) {
        const err = new Error('No valid product image provided. Please upload or supply a primary product image.');
        err.code = 'IMAGE_MISSING';
        err.status = 400;
        throw err;
    }

    // Normalize mimeType
    const mimeLower = resolvedMime.toLowerCase();
    const cleanMime = mimeLower.includes('png')
        ? 'image/png'
        : mimeLower.includes('webp')
            ? 'image/webp'
            : 'image/jpeg';

    // Construct prompt contextualizing existing structured product data
    const contextItems = [];
    if (productContext.product_code) contextItems.push(`Product Code / SKU: ${productContext.product_code}`);
    if (productContext.category) contextItems.push(`Category: ${productContext.category}`);
    if (productContext.audience) contextItems.push(`Target Audience: ${productContext.audience}`);
    if (productContext.material) contextItems.push(`Material: ${productContext.material}`);
    if (productContext.purity) contextItems.push(`Purity: ${productContext.purity}`);
    if (productContext.finish) contextItems.push(`Finish: ${productContext.finish}`);
    if (productContext.weight) contextItems.push(`Weight: ${productContext.weight}g`);
    if (productContext.size) contextItems.push(`Size: ${productContext.size}`);
    if (productContext.design) contextItems.push(`Design / Style: ${productContext.design}`);
    if (productContext.occasion_slug) contextItems.push(`Occasion: ${productContext.occasion_slug}`);

    const contextPrompt = contextItems.length > 0
        ? `Existing verified product context:\n${contextItems.join('\n')}\n\nPlease analyze the uploaded product image in harmony with this verified product context.`
        : 'Please analyze the uploaded product image to identify the jewellery piece and generate complete e-commerce product copy and SEO metadata.';

    const configuredModel = (process.env.GEMINI_PRODUCT_CONTENT_MODEL || 'gemini-3.5-flash-lite').trim();
    const fallbackModel = 'gemini-3.8-flash';
    const modelsToTry = [configuredModel];
    if (configuredModel !== fallbackModel) {
        modelsToTry.push(fallbackModel);
    }

    const ai = new GoogleGenAI({ apiKey });
    let lastError = null;
    let parsedResult = null;
    let successfulModel = null;

    for (const currentModel of modelsToTry) {
        try {
            console.log(`[AI Product Content] Calling model '${currentModel}' for product copy generation...`);

            const timeoutMs = 45000;
            const apiPromise = ai.models.generateContent({
                model: currentModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                inlineData: {
                                    mimeType: cleanMime,
                                    data: resolvedBase64
                                }
                            },
                            {
                                text: contextPrompt
                            }
                        ]
                    }
                ],
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    responseMimeType: 'application/json',
                    responseSchema: RESPONSE_SCHEMA,
                    temperature: 0.3
                }
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Gemini request timed out after ${timeoutMs / 1000} seconds`)), timeoutMs)
            );

            const response = await Promise.race([apiPromise, timeoutPromise]);
            const responseText = response?.text;

            if (!responseText) {
                throw new Error('Gemini returned an empty response');
            }

            const rawJson = JSON.parse(responseText);
            parsedResult = sanitizeGeneratedContent(rawJson);
            successfulModel = currentModel;
            break;
        } catch (err) {
            console.warn(`[AI Product Content] Model '${currentModel}' failed:`, err.message);
            lastError = err;
        }
    }

    if (!parsedResult) {
        const errorMsg = lastError?.message || 'Failed to generate product content with Gemini';
        const isRateLimit = String(errorMsg).includes('429') || String(errorMsg).toLowerCase().includes('quota');
        const isAuth = String(errorMsg).includes('401') || String(errorMsg).includes('403');

        const clientErr = new Error(
            isRateLimit
                ? 'Gemini API rate limit reached. Please wait a moment and try again.'
                : isAuth
                    ? 'Gemini authentication failed. Please check server API key configuration.'
                    : 'AI generation failed. Please try again.'
        );
        clientErr.code = isRateLimit ? 'RATE_LIMIT_EXCEEDED' : isAuth ? 'AUTH_FAILED' : 'AI_GENERATION_FAILED';
        clientErr.status = isRateLimit ? 429 : isAuth ? 401 : 502;
        throw clientErr;
    }

    console.log(`[AI Product Content] Successfully generated product content using '${successfulModel}'`);
    return {
        success: true,
        model: successfulModel,
        data: parsedResult
    };
}
