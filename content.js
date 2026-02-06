// Content script for extracting page content

function extractPageContent() {
  // Try to get the main content using various strategies
  let content = '';
  let title = document.title || '';
  let url = window.location.href;

  // Strategy 1: Look for article element
  const article = document.querySelector('article');
  if (article) {
    content = article.innerText;
  }

  // Strategy 2: Look for main element
  if (!content) {
    const main = document.querySelector('main');
    if (main) {
      content = main.innerText;
    }
  }

  // Strategy 3: Look for common content containers
  if (!content) {
    const selectors = [
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content-area',
      '#content',
      '.content'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.innerText.length > 200) {
        content = element.innerText;
        break;
      }
    }
  }

  // Strategy 4: Fallback to body content (cleaned)
  if (!content) {
    // Clone body to avoid modifying the page
    const bodyClone = document.body.cloneNode(true);

    // Remove non-content elements
    const removeSelectors = [
      'script', 'style', 'nav', 'header', 'footer',
      'aside', '.sidebar', '.navigation', '.menu',
      '.advertisement', '.ad', '#comments', '.comments',
      'iframe', 'noscript'
    ];

    removeSelectors.forEach(selector => {
      bodyClone.querySelectorAll(selector).forEach(el => el.remove());
    });

    content = bodyClone.innerText;
  }

  // Clean up the content
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  // Get meta description if available
  const metaDesc = document.querySelector('meta[name="description"]');
  const description = metaDesc ? metaDesc.getAttribute('content') : '';

  return {
    title,
    url,
    content,
    description,
    timestamp: Date.now()
  };
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    const pageData = extractPageContent();
    sendResponse(pageData);
  }
  return true;
});
