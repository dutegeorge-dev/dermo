/**
 * Минимальная декларация типов для @11ty/eleventy-img (пакет без своих типов).
 * Покрывает только используемое в eleventy.config.ts: вызов Image() и
 * статический generateHTML().
 */
declare module "@11ty/eleventy-img" {
  interface ImageOptions {
    widths?: (number | null)[];
    formats?: (string | null)[];
    outputDir?: string;
    urlPath?: string;
    [key: string]: unknown;
  }

  interface GenerateHTMLOptions {
    alt?: string;
    sizes?: string;
    loading?: string;
    decoding?: string;
    class?: string;
    [key: string]: unknown;
  }

  type Metadata = Record<string, unknown>;

  function Image(src: string, options?: ImageOptions): Promise<Metadata>;

  namespace Image {
    function generateHTML(
      metadata: Metadata,
      attributes: GenerateHTMLOptions,
    ): string;
  }

  export default Image;
}
