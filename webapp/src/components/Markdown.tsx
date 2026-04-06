import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Lightbox } from './Lightbox';

declare global {
  interface Window {
    marked: { parse: (src: string) => string; setOptions: (opts: Record<string, unknown>) => void };
    DOMPurify: { sanitize: (html: string, opts?: Record<string, unknown>) => string };
    hljs: {
      highlightElement: (el: Element) => void;
      highlight: (code: string, opts: { language: string }) => { value: string };
      highlightAuto: (code: string) => { value: string };
      getLanguage: (lang: string) => unknown;
    };
  }
}

interface MarkdownProps {
  content: string;
  streaming?: boolean;
}

/**
 * Renders markdown content safely using DOMPurify.sanitize to prevent XSS.
 * All HTML is sanitized before being injected into the DOM.
 */
export function Markdown({ content, streaming }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const renderSanitizedHtml = useCallback((): string => {
    if (!content) return '';
    const { marked, DOMPurify } = window;
    if (!marked || !DOMPurify) {
      // Fallback: plain text only, no HTML injection
      return '';
    }

    try {
      const src = streaming ? content + ' \u2588' : content;
      // DOMPurify.sanitize prevents XSS by stripping dangerous HTML/JS
      return DOMPurify.sanitize(marked.parse(src), { USE_PROFILES: { html: true } });
    } catch {
      return '';
    }
  }, [content, streaming]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const sanitized = renderSanitizedHtml();
    if (sanitized) {
      // Safe: content has been sanitized by DOMPurify above
      el.innerHTML = sanitized; // nosemgrep: innerHTML-xss — sanitized by DOMPurify
    } else {
      // Fallback: set as plain text (no XSS risk)
      el.textContent = content + (streaming ? ' \u2588' : '');
      return;
    }

    // Highlight code blocks
    if (window.hljs) {
      el.querySelectorAll('pre code').forEach((block) => {
        window.hljs.highlightElement(block);
      });
    }

    // Add copy buttons to <pre> blocks
    el.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className =
        'copy-btn absolute top-2 right-2 text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 opacity-0 group-hover/pre:opacity-100 transition-opacity';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(
            pre.querySelector('code')?.textContent || pre.textContent || '',
          );
          btn.textContent = 'Copied!';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1500);
        } catch {
          btn.textContent = 'Failed';
        }
      });
      pre.classList.add('relative', 'group/pre');
      pre.appendChild(btn);
    });

    // Lazy-load images + click-to-lightbox
    el.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.classList.add('cursor-pointer', 'rounded');
      img.addEventListener('click', () => setLightboxSrc(img.src));
    });
  }, [renderSanitizedHtml, content, streaming]);

  return (
    <>
      <div
        ref={containerRef}
        className="prose prose-sm dark:prose-invert max-w-none break-words"
      />
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}
