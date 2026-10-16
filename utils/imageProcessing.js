// ==============================================================================
// WISHRITE INVENTORY — IMAGE PROCESSING UTILITIES
// High-performance image analysis, aspect-ratio preservation,
// 8K enhancement, and website derivative generation using sharp.
// ==============================================================================

import sharp from 'sharp';

/**
 * Inspect image buffer to extract dimensions and metadata
 */
export async function getImageMetadata(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('Valid image buffer is required to extract metadata');
    }
    const meta = await sharp(buffer).metadata();
    return {
        width: meta.width || 0,
        height: meta.height || 0,
        format: meta.format || 'unknown',
        space: meta.space,
        channels: meta.channels,
        hasAlpha: meta.hasAlpha || false
    };
}

/**
 * Calculate target 8K dimensions preserving exact aspect ratio without stretching
 * Target: ~8192px on the primary axis (8192x8192 for 1:1 square)
 */
export function calculate8KDimensions(originalWidth, originalHeight) {
    const TARGET_MAX_DIMENSION = 8192;
    const width = Number(originalWidth) || TARGET_MAX_DIMENSION;
    const height = Number(originalHeight) || TARGET_MAX_DIMENSION;

    if (width <= 0 || height <= 0) {
        return { targetWidth: TARGET_MAX_DIMENSION, targetHeight: TARGET_MAX_DIMENSION, aspectRatio: 1.0 };
    }

    const aspectRatio = width / height;

    let targetWidth;
    let targetHeight;

    if (Math.abs(aspectRatio - 1.0) < 0.05) {
        // Square (1:1)
        targetWidth = TARGET_MAX_DIMENSION;
        targetHeight = TARGET_MAX_DIMENSION;
    } else if (aspectRatio > 1.0) {
        // Landscape (e.g. 3:2, 4:3, 16:9)
        targetWidth = TARGET_MAX_DIMENSION;
        targetHeight = Math.round(TARGET_MAX_DIMENSION / aspectRatio);
    } else {
        // Portrait (e.g. 2:3, 3:4, 9:16)
        targetHeight = TARGET_MAX_DIMENSION;
        targetWidth = Math.round(TARGET_MAX_DIMENSION * aspectRatio);
    }

    return {
        targetWidth,
        targetHeight,
        aspectRatio: Number(aspectRatio.toFixed(4)),
        isSquare: Math.abs(aspectRatio - 1.0) < 0.05
    };
}

/**
 * Resize and enhance image using Lanczos3 interpolation with subtle jewellery sharpening
 */
export async function enhanceAndResize(buffer, targetWidth, targetHeight, options = {}) {
    const {
        quality = 95,
        sharpening = true,
        format = 'webp'
    } = options;

    let pipeline = sharp(buffer)
        .rotate() // Auto-orient based on EXIF
        .resize({
            width: targetWidth,
            height: targetHeight,
            fit: 'inside',
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        });

    if (sharpening) {
        // Fine jewellery tuning: accentuates stones and 925 sterling edges without halo artifacts
        pipeline = pipeline.sharpen({
            sigma: 1.1,
            m1: 1.2,
            m2: 0.6
        });
    }

    if (format === 'webp') {
        pipeline = pipeline.webp({ quality, effort: 4 });
    } else if (format === 'jpeg' || format === 'jpg') {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (format === 'png') {
        pipeline = pipeline.png({ compressionLevel: 8 });
    }

    const outputBuffer = await pipeline.toBuffer();
    const meta = await sharp(outputBuffer).metadata();

    return {
        buffer: outputBuffer,
        width: meta.width || targetWidth,
        height: meta.height || targetHeight,
        format: meta.format || format,
        sizeBytes: outputBuffer.length
    };
}

/**
 * Generate standard website derivatives from an 8K/4K master:
 * - Desktop: 2400px
 * - Mobile: 1200px
 * - Thumbnail: 600px
 * - Zoom: 4096px
 */
export async function generateWebsiteDerivatives(masterBuffer) {
    if (!masterBuffer || !Buffer.isBuffer(masterBuffer)) {
        throw new Error('Valid master image buffer is required to generate derivatives');
    }

    const meta = await getImageMetadata(masterBuffer);
    const aspect = (meta.width && meta.height) ? meta.width / meta.height : 1.0;

    const derivativeConfigs = [
        { key: 'zoom', maxDim: 4096, quality: 92, fileName: 'zoom_4096.webp' },
        { key: 'desktop', maxDim: 2400, quality: 88, fileName: 'desktop_2400.webp' },
        { key: 'mobile', maxDim: 1200, quality: 84, fileName: 'mobile_1200.webp' },
        { key: 'thumbnail', maxDim: 600, quality: 80, fileName: 'thumb_600.webp' }
    ];

    const results = {};

    for (const cfg of derivativeConfigs) {
        let w, h;
        if (aspect >= 1.0) {
            w = cfg.maxDim;
            h = Math.round(cfg.maxDim / aspect);
        } else {
            h = cfg.maxDim;
            w = Math.round(cfg.maxDim * aspect);
        }

        const derivative = await sharp(masterBuffer)
            .resize({
                width: w,
                height: h,
                fit: 'inside',
                kernel: sharp.kernel.lanczos3
            })
            .sharpen({ sigma: 0.8, m1: 0.8, m2: 0.4 })
            .webp({ quality: cfg.quality, effort: 3 })
            .toBuffer();

        const dMeta = await sharp(derivative).metadata();

        results[cfg.key] = {
            buffer: derivative,
            width: dMeta.width || w,
            height: dMeta.height || h,
            fileName: cfg.fileName,
            format: 'webp',
            sizeBytes: derivative.length
        };
    }

    return results;
}
