// Background service worker for API calls

// OpenAI API call
async function callOpenAI(apiKey, model, messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API request failed');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Get storage value helper
async function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'chat') {
    handleChat(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'openChat') {
    // Store page data for chat page to retrieve
    chrome.storage.session.set({ currentPageData: request.pageData });
    // Open chat in new tab
    chrome.tabs.create({ url: 'chat.html' });
    sendResponse({ success: true });
    return true;
  }
});

async function handleSummarize(request) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    throw new Error('Please set your OpenAI API key in the extension settings');
  }

  const model = await getStorageValue('openai_model') || 'gpt-4o-mini';

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that summarizes web content clearly and concisely.'
    },
    {
      role: 'user',
      content: request.prompt
    }
  ];

  const result = await callOpenAI(apiKey, model, messages);
  return { result };
}

async function handleChat(request) {
  const apiKey = await getStorageValue('openai_api_key');
  if (!apiKey) {
    throw new Error('Please set your OpenAI API key in the extension settings');
  }

  const model = await getStorageValue('openai_model') || 'gpt-4o-mini';

  const result = await callOpenAI(apiKey, model, request.messages);
  return { result };
}
